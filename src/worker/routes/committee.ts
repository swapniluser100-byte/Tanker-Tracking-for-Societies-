import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, like } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { alerts, complaints, expenses, municipalSupplyLogs, notices, notificationTemplates, tankReadings, tanks } from '../db/schema';
import { requireRole } from '../middleware/auth';
import { BOOKING_MANAGERS, COMMITTEE_VIEW, EXPENSE_MANAGERS, GUARD_APP } from '../../shared/roles';
import { costPerFlatPaise } from '../../shared/calc';
import { formatClock, formatLitres, istDate, istWeekday, renderTemplate } from '../../shared/format';
import { auditQuery } from '../lib/audit';
import { csvResponse, currentUser, fail, nowIso, parseId, toCsv } from '../lib/http';
import { zDate, zOptionalText, zPaise, zTime, zv } from '../lib/validate';
import { getSetting, getSociety, monthOf, monthTotals, municipalSummary, storageSummary, tankStatuses, vendorStats } from '../lib/stats';

const committee = new Hono<AppEnv>();

// ── Tanks ──────────────────────────────────────────────────────────────────
committee.get('/tanks', requireRole(...COMMITTEE_VIEW, 'guard'), async (c) => {
  const tanksList = await tankStatuses(c.env.DB);
  return c.json({ tanks: tanksList, storage: storageSummary(tanksList) });
});

committee.get('/tanks/:id/readings', requireRole(...COMMITTEE_VIEW), zv('query', z.object({ hours: z.coerce.number().int().min(1).max(24 * 31).default(48) })), async (c) => {
  const since = new Date(Date.now() - c.req.valid('query').hours * 3600_000).toISOString();
  const res = await c.env.DB.prepare(`SELECT level_pct, litres, source, created_at FROM tank_readings WHERE tank_id = ? AND created_at >= ? ORDER BY created_at`)
    .bind(parseId(c.req.param('id')), since).all();
  return c.json({ readings: res.results });
});

/** Manual tank reading (dip-stick / gauge), entered by committee or guards. */
committee.post('/tanks/:id/readings', requireRole(...GUARD_APP), zv('json', z.object({ levelPct: z.number().min(0).max(100) })), async (c) => {
  const db = c.get('db');
  const tank = await db.select().from(tanks).where(eq(tanks.id, parseId(c.req.param('id')))).get();
  if (!tank) fail(404, 'Tank not found');
  const levelPct = Math.round(c.req.valid('json').levelPct * 10) / 10;
  const reading = { tankId: tank.id, levelPct, litres: Math.round((levelPct / 100) * tank.capacityLitres), source: 'manual' as const, userId: currentUser(c).id };
  await db.batch([db.insert(tankReadings).values(reading), auditQuery(c, { action: 'create', entity: 'tank_reading', entityId: tank.id, after: reading })]);
  return c.json({ ok: true, reading }, 201);
});

// ── Vendors (read-only here; editing is in the admin console) ──────────────
committee.get('/vendors', requireRole(...COMMITTEE_VIEW), async (c) => c.json({ vendors: await vendorStats(c.env.DB) }));

committee.get('/vendors/:id/history', requireRole(...COMMITTEE_VIEW), async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT b.code, b.date, b.count, b.size_litres, b.status, COALESCE(b.final_cost_paise, b.cost_paise) AS cost_paise,
            c.vehicle_number, c.litres_received, c.short_by_litres, c.on_time, c.arrived_at
     FROM tanker_bookings b LEFT JOIN delivery_checkins c ON c.booking_id = b.id
     WHERE b.vendor_id = ? ORDER BY b.date DESC, b.id DESC LIMIT 100`,
  ).bind(parseId(c.req.param('id'))).all();
  return c.json({ history: res.results });
});

// ── Expenses ───────────────────────────────────────────────────────────────
committee.get('/expenses', requireRole(...COMMITTEE_VIEW), zv('query', z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })), async (c) => {
  const ym = c.req.valid('query').month ?? monthOf();
  const d1 = c.env.DB;
  const [list, unpaid, society, month] = await Promise.all([
    d1.prepare(
      `SELECT e.*, v.name AS vendor, b.code AS booking_code, u.name AS created_by_name FROM expenses e
       LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN tanker_bookings b ON b.id = e.booking_id LEFT JOIN users u ON u.id = e.created_by
       WHERE substr(e.paid_date, 1, 7) = ? ORDER BY e.paid_date DESC, e.id DESC`,
    ).bind(ym).all(),
    d1.prepare(
      `SELECT b.id, b.code, b.date, v.id AS vendor_id, v.name AS vendor, v.upi_id, COALESCE(b.final_cost_paise, b.cost_paise) AS amount_paise
       FROM tanker_bookings b JOIN vendors v ON v.id = b.vendor_id
       WHERE b.status = 'delivered' AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.booking_id = b.id)
       ORDER BY b.date DESC LIMIT 100`,
    ).all(),
    getSociety(c.get('db')),
    monthTotals(d1, ym),
  ]);
  const paidTotal = (list.results as { amount_paise: number }[]).reduce((a, r) => a + r.amount_paise, 0);
  return c.json({
    month: ym, expenses: list.results, unpaidBookings: unpaid.results, paidTotalPaise: paidTotal,
    tankerSpendPaise: month.spentPaise, budgetPaise: society.monthlyBudgetPaise,
    costPerFlatPaise: costPerFlatPaise(month.spentPaise, society.flatsCount),
  });
});

committee.post(
  '/expenses',
  requireRole(...EXPENSE_MANAGERS),
  zv('json', z.object({
    bookingId: z.number().int().positive().nullable().optional(),
    vendorId: z.number().int().positive().nullable().optional(),
    description: z.string().trim().min(1).max(200),
    amountPaise: zPaise.refine((v) => v > 0, 'Amount must be more than zero'),
    paymentMode: z.enum(['upi', 'cash', 'bank_transfer', 'cheque']),
    paidDate: zDate,
    reference: zOptionalText(80),
  })),
  async (c) => {
    const body = c.req.valid('json');
    if (body.paidDate > istDate()) fail(400, 'Paid date cannot be in the future.');
    const db = c.get('db');
    const [row] = await db.insert(expenses).values({ ...body, bookingId: body.bookingId ?? null, vendorId: body.vendorId ?? null, createdBy: currentUser(c).id }).returning();
    await auditQuery(c, { action: 'create', entity: 'expense', entityId: row.id, after: row });
    return c.json({ expense: row }, 201);
  },
);

committee.delete('/expenses/:id', requireRole(...EXPENSE_MANAGERS), async (c) => {
  const db = c.get('db');
  const id = parseId(c.req.param('id'));
  const before = await db.select().from(expenses).where(eq(expenses.id, id)).get();
  if (!before) fail(404, 'Expense not found');
  await db.batch([db.delete(expenses).where(eq(expenses.id, id)), auditQuery(c, { action: 'delete', entity: 'expense', entityId: id, before })]);
  return c.json({ ok: true });
});

// ── Notices ────────────────────────────────────────────────────────────────
committee.get('/notices', requireRole(...COMMITTEE_VIEW), async (c) => {
  const rows = await c.get('db').select().from(notices).orderBy(desc(notices.createdAt)).limit(100);
  return c.json({ notices: rows });
});

const noticeSchema = z.object({
  title: z.string().trim().min(1).max(140),
  titleMr: zOptionalText(140),
  body: z.string().trim().min(1).max(2000),
  bodyMr: zOptionalText(2000),
  priority: z.enum(['info', 'important', 'urgent']).default('info'),
  expiresAt: zDate.nullable().optional(),
});

committee.post('/notices', requireRole(...BOOKING_MANAGERS), zv('json', noticeSchema), async (c) => {
  const body = c.req.valid('json');
  const db = c.get('db');
  const [row] = await db.insert(notices).values({ ...body, expiresAt: body.expiresAt ?? null, createdBy: currentUser(c).id }).returning();
  await auditQuery(c, { action: 'create', entity: 'notice', entityId: row.id, after: row });
  return c.json({ notice: row }, 201);
});

committee.delete('/notices/:id', requireRole(...BOOKING_MANAGERS), async (c) => {
  const db = c.get('db');
  const id = parseId(c.req.param('id'));
  const before = await db.select().from(notices).where(eq(notices.id, id)).get();
  if (!before) fail(404, 'Notice not found');
  await db.batch([db.delete(notices).where(eq(notices.id, id)), auditQuery(c, { action: 'delete', entity: 'notice', entityId: id, before })]);
  return c.json({ ok: true });
});

// ── Complaints ─────────────────────────────────────────────────────────────
committee.get('/complaints', requireRole(...COMMITTEE_VIEW), async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT k.*, u.name AS user_name, u.phone AS user_phone, w.name || '-' || f.number AS flat FROM complaints k
     LEFT JOIN users u ON u.id = k.user_id LEFT JOIN flats f ON f.id = k.flat_id LEFT JOIN wings w ON w.id = f.wing_id
     ORDER BY CASE k.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, k.created_at DESC LIMIT 200`,
  ).all();
  return c.json({ complaints: res.results });
});

committee.patch('/complaints/:id', requireRole(...BOOKING_MANAGERS), zv('json', z.object({ status: z.enum(['open', 'in_progress', 'resolved']) })), async (c) => {
  const db = c.get('db');
  const id = parseId(c.req.param('id'));
  const before = await db.select().from(complaints).where(eq(complaints.id, id)).get();
  if (!before) fail(404, 'Complaint not found');
  const { status } = c.req.valid('json');
  const patch = { status, resolvedAt: status === 'resolved' ? nowIso() : null };
  await db.batch([db.update(complaints).set(patch).where(eq(complaints.id, id)), auditQuery(c, { action: 'update', entity: 'complaint', entityId: id, before: { status: before.status }, after: patch })]);
  return c.json({ ok: true });
});

// ── Municipal (PMC/PCMC) supply ────────────────────────────────────────────
committee.get('/municipal', requireRole(...COMMITTEE_VIEW, 'guard'), async (c) => c.json(await municipalSummary(c.env.DB)));

committee.post(
  '/municipal/logs',
  requireRole(...GUARD_APP),
  zv('json', z.object({
    date: zDate.optional(),
    came: z.boolean(),
    actualStart: zTime.nullable().optional(),
    actualEnd: zTime.nullable().optional(),
    notes: zOptionalText(300),
  })),
  async (c) => {
    const body = c.req.valid('json');
    const date = body.date ?? istDate();
    if (date > istDate()) fail(400, 'Cannot log supply for a future date.');
    const db = c.get('db');
    // Delay is measured against the scheduled start for that weekday, if there is one.
    const weekday = istWeekday(new Date(`${date}T12:00:00+05:30`));
    const sched = await c.env.DB.prepare(`SELECT start_time FROM municipal_schedule WHERE weekday = ? AND is_active = 1 ORDER BY start_time LIMIT 1`).bind(weekday).first<{ start_time: string }>();
    let delayMinutes: number | null = null;
    if (body.came && body.actualStart && sched) {
      const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      delayMinutes = Math.max(0, toMin(body.actualStart) - toMin(sched.start_time));
    }
    const values = {
      date, came: body.came, actualStart: body.came ? body.actualStart ?? null : null, actualEnd: body.came ? body.actualEnd ?? null : null,
      delayMinutes, notes: body.notes, loggedBy: currentUser(c).id,
    };
    const before = await db.select().from(municipalSupplyLogs).where(eq(municipalSupplyLogs.date, date)).get();
    await db.batch([
      db.insert(municipalSupplyLogs).values(values).onConflictDoUpdate({ target: municipalSupplyLogs.date, set: values }),
      auditQuery(c, { action: before ? 'update' : 'create', entity: 'municipal_supply_log', entityId: date, before, after: values }),
    ]);
    return c.json({ ok: true, log: values }, before ? 200 : 201);
  },
);

// ── Alerts ─────────────────────────────────────────────────────────────────
committee.post('/alerts/:id/ack', requireRole(...COMMITTEE_VIEW), async (c) => {
  const db = c.get('db');
  const id = parseId(c.req.param('id'));
  const patch = { acknowledgedBy: currentUser(c).id, acknowledgedAt: nowIso() };
  await db.batch([db.update(alerts).set(patch).where(eq(alerts.id, id)), auditQuery(c, { action: 'acknowledge', entity: 'alert', entityId: id, after: patch })]);
  return c.json({ ok: true });
});

// ── Reports & WhatsApp ─────────────────────────────────────────────────────
committee.get('/reports/monthly.csv', requireRole(...COMMITTEE_VIEW), zv('query', z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })), async (c) => {
  const ym = c.req.valid('query').month ?? monthOf();
  const society = await getSociety(c.get('db'));
  const res = await c.env.DB.prepare(
    `SELECT b.code, b.date, s.label AS slot, v.name AS vendor, b.count, b.size_litres * b.count AS litres_ordered,
            c.litres_received, c.short_by_litres, CASE c.on_time WHEN 1 THEN 'yes' WHEN 0 THEN 'no' END AS on_time,
            c.vehicle_number, b.status, b.cost_paise, b.final_cost_paise
     FROM tanker_bookings b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN delivery_slots s ON s.id = b.slot_id
     LEFT JOIN delivery_checkins c ON c.booking_id = b.id
     WHERE substr(b.date, 1, 7) = ? ORDER BY b.date, s.start_time`,
  ).bind(ym).all<Record<string, number | string | null>>();
  const rows = res.results.map((r) => ({
    ...r,
    estimated_cost_rupees: ((r.cost_paise as number) / 100).toFixed(2),
    final_cost_rupees: r.final_cost_paise == null ? '' : ((r.final_cost_paise as number) / 100).toFixed(2),
  }));
  const totals = await monthTotals(c.env.DB, ym);
  rows.push({ code: 'TOTAL', date: '', litres_received: totals.litresReceived, final_cost_rupees: (totals.spentPaise / 100).toFixed(2) } as never);
  rows.push({ code: 'COST PER FLAT', date: `${society.flatsCount} flats`, final_cost_rupees: (costPerFlatPaise(totals.spentPaise, society.flatsCount) / 100).toFixed(2) } as never);
  const cols = ['code', 'date', 'slot', 'vendor', 'count', 'litres_ordered', 'litres_received', 'short_by_litres', 'on_time', 'vehicle_number', 'status', 'estimated_cost_rupees', 'final_cost_rupees'];
  return csvResponse(`jalsetu-${ym}-tanker-report.csv`, toCsv(rows, cols));
});

/** Renders a notification template with live values, for the "Send WhatsApp update" button. */
committee.get('/reports/whatsapp', requireRole(...COMMITTEE_VIEW), zv('query', z.object({ key: z.string().max(60).default('daily_update'), lang: z.enum(['en', 'mr']).default('en') })), async (c) => {
  const { key, lang } = c.req.valid('query');
  const db = c.get('db');
  const tpl = await db.select().from(notificationTemplates).where(and(eq(notificationTemplates.key, key), eq(notificationTemplates.language, lang), like(notificationTemplates.channel, 'whatsapp'))).get();
  if (!tpl) fail(404, 'Template not found. Add it under Admin → Notification templates.');
  const [society, tanksList, municipal, timings, todayCount] = await Promise.all([
    getSociety(db),
    tankStatuses(c.env.DB),
    municipalSummary(c.env.DB),
    getSetting<{ start: string; end: string }[]>(db, 'water_release_timings', []),
    c.env.DB.prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM tanker_bookings WHERE date = ? AND status IN ('confirmed','on_the_way','delivered')`).bind(istDate()).first<{ n: number }>(),
  ]);
  const storage = storageSummary(tanksList);
  const mr = lang === 'mr';
  const pmc = municipal.todayLog
    ? municipal.todayLog.came ? (mr ? `आले (${municipal.todayLog.actualStart ?? ''})` : `came at ${formatClock(municipal.todayLog.actualStart ?? '00:00')}`) : (mr ? 'आले नाही' : 'did not come')
    : municipal.next ? `${municipal.next.authority} ${municipal.next.date === istDate() ? (mr ? 'आज' : 'today') : municipal.next.date} ${formatClock(municipal.next.startTime)}` : '—';
  const text = renderTemplate(tpl.text, {
    society: society.name,
    litres: formatLitres(storage.litres),
    percent: Math.round(storage.pct),
    tankers: todayCount?.n ?? 0,
    pmc,
    time: timings.map((t) => `${formatClock(t.start)}–${formatClock(t.end)}`).join(', '),
  });
  return c.json({ text, url: `https://wa.me/?text=${encodeURIComponent(text)}` });
});

export default committee;
