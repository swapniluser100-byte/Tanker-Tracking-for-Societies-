import { Hono } from 'hono';
import { z } from 'zod';
import { asc, eq, sql } from 'drizzle-orm';
import type { AppEnv } from '../../env';
import {
  deliverySlots, flats, municipalSchedule, notificationTemplates, settings, societies, tankerSizes, tanks, vendors, wings,
} from '../../db/schema';
import { requireRole } from '../../middleware/auth';
import { ADMIN_CONSOLE, SUPER_ONLY } from '../../../shared/roles';
import { istDate } from '../../../shared/format';
import { auditQuery } from '../../lib/audit';
import { fail, nowIso, parseId } from '../../lib/http';
import { zPaise, zPhone, zTime, zv } from '../../lib/validate';
import { getSetting, getSociety, monthOf, monthTotals } from '../../lib/stats';
import { registerCrud } from './crud';
import usersRoutes from './users';
import keysRoutes from './keys';
import dataRoutes from './data';

const admin = new Hono<AppEnv>();
admin.use('*', requireRole(...ADMIN_CONSOLE));

// ── Overview ───────────────────────────────────────────────────────────────
admin.get('/overview', async (c) => {
  const d1 = c.env.DB;
  const startOfDayUtc = new Date(`${istDate()}T00:00:00+05:30`).toISOString();
  const t0 = Date.now();
  const counts = await d1.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE is_active = 1) AS active_users,
       (SELECT COUNT(*) FROM users) AS total_users,
       (SELECT COUNT(*) FROM users WHERE locked_until > ?) AS locked_users,
       (SELECT COUNT(*) FROM sessions WHERE expires_at > ?) AS active_sessions,
       (SELECT COUNT(*) FROM audit_logs WHERE action IN ('login_failed','account_locked') AND created_at >= ?) AS failed_logins_today,
       (SELECT COUNT(*) FROM tanker_bookings WHERE substr(date, 1, 7) = ?) AS bookings_this_month,
       (SELECT COUNT(*) FROM tanker_bookings WHERE status = 'pending_approval') AS pending_approvals,
       (SELECT MAX(created_at) FROM tank_readings WHERE source = 'sensor') AS last_sensor_reading,
       (SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL) AS active_api_keys`,
  ).bind(nowIso(), nowIso(), startOfDayUtc, monthOf()).first<Record<string, number | string | null>>();
  const dbLatencyMs = Date.now() - t0;
  const byRole = await d1.prepare(`SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role`).all<{ role: string; n: number }>();

  let r2 = 'ok';
  try { await c.env.PHOTOS.head('healthcheck'); } catch { r2 = 'error'; }
  let kv = 'ok';
  try { await c.env.RATE_LIMIT.get('healthcheck'); } catch { kv = 'error'; }

  const lastSensor = counts?.last_sensor_reading as string | null;
  const sensorAgeMin = lastSensor ? Math.round((Date.now() - Date.parse(lastSensor)) / 60000) : null;
  const month = await monthTotals(d1, monthOf());
  return c.json({
    health: { database: 'ok', dbLatencyMs, r2, kv, sensor: sensorAgeMin === null ? 'no data' : sensorAgeMin > 30 ? 'stale' : 'ok' },
    counts, usersByRole: byRole.results, lastSensorReading: lastSensor, sensorAgeMinutes: sensorAgeMin, month,
    environment: c.env.APP_ENV,
  });
});

// ── Society settings ───────────────────────────────────────────────────────
admin.get('/society', async (c) => {
  const db = c.get('db');
  const [society, releaseTimings] = await Promise.all([getSociety(db), getSetting(db, 'water_release_timings', [] as { start: string; end: string }[])]);
  return c.json({ society, releaseTimings });
});

admin.put(
  '/society',
  zv('json', z.object({
    name: z.string().trim().min(1).max(120),
    area: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(60),
    flatsCount: z.number().int().min(1).max(10000),
    monthlyBudgetPaise: zPaise,
    approvalLimitPaise: zPaise,
    shortToleranceLitres: z.number().int().min(0).max(5000),
    lowAlertPct: z.number().int().min(5).max(90),
    releaseTimings: z.array(z.object({ start: zTime, end: zTime }).refine((w) => w.start < w.end, 'Start must be before end')).max(6),
  })),
  async (c) => {
    const db = c.get('db');
    const { releaseTimings, ...values } = c.req.valid('json');
    const before = await getSociety(db);
    const beforeTimings = await getSetting(db, 'water_release_timings', []);
    const timingsJson = JSON.stringify(releaseTimings);
    await db.batch([
      db.update(societies).set({ ...values, updatedAt: nowIso() }).where(eq(societies.id, before.id)),
      db.insert(settings).values({ key: 'water_release_timings', value: timingsJson })
        .onConflictDoUpdate({ target: settings.key, set: { value: timingsJson, updatedAt: nowIso() } }),
      auditQuery(c, { action: 'update', entity: 'society', entityId: before.id, before: { ...before, releaseTimings: beforeTimings }, after: { ...values, releaseTimings } }),
    ]);
    return c.json({ ok: true });
  },
);

// ── Wings ──────────────────────────────────────────────────────────────────
const wingSchema = z.object({ name: z.string().trim().toUpperCase().min(1).max(20) });
registerCrud(admin, { path: '/wings', table: wings, entity: 'wing', create: wingSchema, update: wingSchema, orderBy: asc(wings.name) });

// ── Flats (list with wing names, CRUD, CSV import) ─────────────────────────
admin.get('/flats', async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT f.id, f.number, f.wing_id, w.name AS wing,
            (SELECT COUNT(*) FROM users u WHERE u.flat_id = f.id) AS residents
     FROM flats f JOIN wings w ON w.id = f.wing_id ORDER BY w.name, CAST(f.number AS INTEGER), f.number`,
  ).all();
  return c.json({ items: res.results });
});
const flatSchema = z.object({ wingId: z.number().int().positive(), number: z.string().trim().toUpperCase().min(1).max(10) });
registerCrud(admin, { path: '/flats', table: flats, entity: 'flat', create: flatSchema, update: flatSchema });

/** CSV import: one "wing,flat" pair per line (header optional). Missing wings are created. */
admin.post('/flats/import', zv('json', z.object({ csv: z.string().max(200_000) })), async (c) => {
  const db = c.get('db');
  const lines = c.req.valid('json').csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] && /wing/i.test(lines[0])) lines.shift();
  const pairs: { wing: string; number: string }[] = [];
  const errors: string[] = [];
  lines.forEach((line, i) => {
    const [wing, number] = line.split(/[,;\t]/).map((s) => s?.trim().replace(/^"|"$/g, '').toUpperCase());
    if (!wing || !number || wing.length > 20 || number.length > 10) errors.push(`Line ${i + 1}: expected "wing,flat"`);
    else pairs.push({ wing, number });
  });
  if (errors.length) return c.json({ error: `${errors.length} invalid line(s)`, errors: errors.slice(0, 20) }, 400);
  if (pairs.length > 5000) fail(400, 'Import at most 5,000 flats at a time.');

  const wingNames = [...new Set(pairs.map((p) => p.wing))];
  for (const name of wingNames) await db.insert(wings).values({ name }).onConflictDoNothing();
  const wingRows = await db.select().from(wings);
  const wingId = new Map(wingRows.map((w) => [w.name, w.id]));
  const before = (await db.select({ n: sql<number>`count(*)` }).from(flats).get())?.n ?? 0;
  const stmts = pairs.map((p) => db.insert(flats).values({ wingId: wingId.get(p.wing)!, number: p.number }).onConflictDoNothing());
  for (let i = 0; i < stmts.length; i += 100) {
    const chunk = stmts.slice(i, i + 100);
    await db.batch(chunk as [typeof chunk[number], ...typeof chunk]);
  }
  const after = (await db.select({ n: sql<number>`count(*)` }).from(flats).get())?.n ?? 0;
  await auditQuery(c, { action: 'import', entity: 'flat', after: { lines: pairs.length, added: after - before, wings: wingNames } });
  return c.json({ ok: true, added: after - before, skipped: pairs.length - (after - before) });
});

// ── Tanks ──────────────────────────────────────────────────────────────────
const tankSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(['sump', 'overhead']),
  capacityLitres: z.number().int().min(500).max(5_000_000),
  wingId: z.number().int().positive().nullable(),
  alertPct: z.number().int().min(5).max(90),
  isActive: z.boolean().default(true),
});
registerCrud(admin, { path: '/tanks', table: tanks, entity: 'tank', create: tankSchema, update: tankSchema, orderBy: asc(tanks.name) });

// ── Vendors ────────────────────────────────────────────────────────────────
const vendorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  area: z.string().trim().min(1).max(80),
  phone: zPhone,
  upiId: z.string().trim().regex(/^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/, 'Enter a UPI ID like name@okaxis').nullable().or(z.literal('').transform(() => null)),
  ratePer10kPaise: zPaise.refine((v) => v > 0, 'Rate must be more than zero'),
  isActive: z.boolean().default(true),
});
registerCrud(admin, { path: '/vendors', table: vendors, entity: 'vendor', create: vendorSchema, update: vendorSchema, orderBy: asc(vendors.name) });

// ── Tanker sizes & delivery slots ──────────────────────────────────────────
const sizeSchema = z.object({ litres: z.number().int().min(1000).max(50_000), label: z.string().trim().min(1).max(40), isActive: z.boolean().default(true) });
registerCrud(admin, { path: '/sizes', table: tankerSizes, entity: 'tanker_size', create: sizeSchema, update: sizeSchema, orderBy: asc(tankerSizes.litres) });

const slotSchema = z
  .object({ label: z.string().trim().min(1).max(40), startTime: zTime, endTime: zTime, isActive: z.boolean().default(true) })
  .refine((s) => s.startTime < s.endTime, { message: 'Start time must be before end time', path: ['endTime'] });
registerCrud(admin, { path: '/slots', table: deliverySlots, entity: 'delivery_slot', create: slotSchema, update: slotSchema, orderBy: asc(deliverySlots.startTime) });

// ── Municipal schedule ─────────────────────────────────────────────────────
const scheduleSchema = z
  .object({ weekday: z.number().int().min(0).max(6), startTime: zTime, endTime: zTime, authority: z.enum(['PMC', 'PCMC']), isActive: z.boolean().default(true) })
  .refine((s) => s.startTime < s.endTime, { message: 'Start time must be before end time', path: ['endTime'] });
registerCrud(admin, { path: '/municipal-schedule', table: municipalSchedule, entity: 'municipal_schedule', create: scheduleSchema, update: scheduleSchema, orderBy: asc(municipalSchedule.weekday) });

// ── Notification templates ─────────────────────────────────────────────────
admin.get('/templates', async (c) => {
  const rows = await c.get('db').select().from(notificationTemplates).orderBy(asc(notificationTemplates.key), asc(notificationTemplates.language));
  return c.json({ items: rows });
});

admin.post(
  '/templates',
  zv('json', z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Use lowercase letters, digits and underscores'),
    language: z.enum(['en', 'mr']),
    channel: z.enum(['whatsapp', 'sms']),
    description: z.string().trim().max(120).optional(),
    text: z.string().trim().min(1).max(1000),
  })),
  async (c) => {
    const db = c.get('db');
    try {
      const [row] = await db.insert(notificationTemplates).values(c.req.valid('json')).returning();
      await auditQuery(c, { action: 'create', entity: 'notification_template', entityId: row.id, after: row });
      return c.json({ item: row }, 201);
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, 'A template with this key, language and channel already exists.');
      throw e;
    }
  },
);

admin.put('/templates/:id', zv('json', z.object({ text: z.string().trim().min(1).max(1000), description: z.string().trim().max(120).optional() })), async (c) => {
  const db = c.get('db');
  const id = parseId(c.req.param('id'));
  const before = await db.select().from(notificationTemplates).where(eq(notificationTemplates.id, id)).get();
  if (!before) fail(404, 'Template not found');
  const patch = { ...c.req.valid('json'), updatedAt: nowIso() };
  await db.batch([
    db.update(notificationTemplates).set(patch).where(eq(notificationTemplates.id, id)),
    auditQuery(c, { action: 'update', entity: 'notification_template', entityId: id, before: { text: before.text }, after: { text: patch.text } }),
  ]);
  return c.json({ ok: true });
});

// ── Audit log ──────────────────────────────────────────────────────────────
admin.get(
  '/audit',
  zv('query', z.object({
    q: z.string().max(80).optional(),
    action: z.string().max(40).optional(),
    entity: z.string().max(40).optional(),
    userId: z.coerce.number().int().positive().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })),
  async (c) => {
    const { q, action, entity, userId, from, to, page } = c.req.valid('query');
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q) { where.push('(a.entity_id LIKE ? OR a.before_json LIKE ? OR a.after_json LIKE ? OR u.name LIKE ? OR a.ip LIKE ?)'); params.push(...Array(5).fill(`%${q}%`)); }
    if (action) { where.push('a.action = ?'); params.push(action); }
    if (entity) { where.push('a.entity = ?'); params.push(entity); }
    if (userId) { where.push('a.user_id = ?'); params.push(userId); }
    if (from) { where.push('a.created_at >= ?'); params.push(new Date(`${from}T00:00:00+05:30`).toISOString()); }
    if (to) { where.push('a.created_at < ?'); params.push(new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString()); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pageSize = 50;
    const [rows, total, facets] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`)
        .bind(...params, pageSize, (page - 1) * pageSize),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${whereSql}`).bind(...params),
      c.env.DB.prepare(`SELECT 'action' AS kind, action AS value FROM audit_logs GROUP BY action UNION ALL SELECT 'entity', entity FROM audit_logs GROUP BY entity`),
    ]);
    return c.json({
      items: rows.results, total: (total.results[0]?.n as number) ?? 0, page, pageSize,
      actions: facets.results.filter((f) => f.kind === 'action').map((f) => f.value),
      entities: facets.results.filter((f) => f.kind === 'entity').map((f) => f.value),
    });
  },
);

// ── Super-admin-only sections ──────────────────────────────────────────────
admin.use('/users/*', requireRole(...SUPER_ONLY));
admin.use('/users', requireRole(...SUPER_ONLY));
admin.use('/sessions/*', requireRole(...SUPER_ONLY));
admin.use('/sessions', requireRole(...SUPER_ONLY));
admin.use('/api-keys/*', requireRole(...SUPER_ONLY));
admin.use('/api-keys', requireRole(...SUPER_ONLY));
admin.route('/', usersRoutes);
admin.route('/api-keys', keysRoutes);
admin.route('/data', dataRoutes);

export default admin;
