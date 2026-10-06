import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { deliverySlots, tankerBookings, tankerSizes, tanks, vendors } from '../db/schema';
import { requireRole } from '../middleware/auth';
import { APPROVERS, BOOKING_MANAGERS, COMMITTEE_VIEW } from '../../shared/roles';
import { bookingCostPaise, costPerFlatPaise } from '../../shared/calc';
import { addDays, istDate } from '../../shared/format';
import { auditQuery } from '../lib/audit';
import { currentUser, fail, nowIso, parseId } from '../lib/http';
import { zDate, zOptionalText, zv } from '../lib/validate';
import { getSociety, monthOf, monthTotals, mostReliableVendorId, tankStatuses, vendorStats } from '../lib/stats';

const bookings = new Hono<AppEnv>();

export const BOOKING_LIST_SQL = `
  SELECT b.id, b.code, b.date, b.status, b.count, b.size_litres, b.cost_paise, b.final_cost_paise, b.rate_per_10k_paise,
         b.eta_at, b.notes, b.created_at, b.approved_at,
         v.id AS vendor_id, v.name AS vendor, v.phone AS vendor_phone,
         s.label AS slot_label, s.start_time, s.end_time,
         t.id AS tank_id, t.name AS tank, t.capacity_litres,
         ub.name AS booked_by, ua.name AS approved_by,
         c.vehicle_number, c.litres_received, c.short_by_litres, c.on_time, c.level_before_pct, c.level_after_pct, c.photo_key, c.arrived_at
  FROM tanker_bookings b
  JOIN vendors v ON v.id = b.vendor_id
  LEFT JOIN delivery_slots s ON s.id = b.slot_id
  LEFT JOIN tanks t ON t.id = b.target_tank_id
  LEFT JOIN users ub ON ub.id = b.booked_by
  LEFT JOIN users ua ON ua.id = b.approved_by
  LEFT JOIN delivery_checkins c ON c.booking_id = b.id`;

/** Options + live budget numbers for the "Book a tanker" screen. */
bookings.get('/options', requireRole(...COMMITTEE_VIEW), async (c) => {
  const db = c.get('db');
  const d1 = c.env.DB;
  const [society, sizes, slots, tankList, vendorList, month] = await Promise.all([
    getSociety(db),
    db.select().from(tankerSizes).where(eq(tankerSizes.isActive, true)).orderBy(tankerSizes.litres),
    db.select().from(deliverySlots).where(eq(deliverySlots.isActive, true)).orderBy(deliverySlots.startTime),
    tankStatuses(d1),
    vendorStats(d1, true),
    monthTotals(d1, monthOf()),
  ]);
  return c.json({
    sizes, slots, tanks: tankList, vendors: vendorList,
    mostReliableVendorId: mostReliableVendorId(vendorList),
    society: { flatsCount: society.flatsCount, monthlyBudgetPaise: society.monthlyBudgetPaise, approvalLimitPaise: society.approvalLimitPaise },
    month,
    today: istDate(),
  });
});

bookings.get(
  '/',
  requireRole(...COMMITTEE_VIEW),
  zv('query', z.object({
    status: z.string().max(40).optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    q: z.string().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })),
  async (c) => {
    const { status, from, to, q, limit } = c.req.valid('query');
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (status) { where.push('b.status = ?'); params.push(status); }
    if (from) { where.push('b.date >= ?'); params.push(from); }
    if (to) { where.push('b.date <= ?'); params.push(to); }
    if (q) { where.push('(b.code LIKE ? OR v.name LIKE ? OR c.vehicle_number LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const res = await c.env.DB.prepare(`${BOOKING_LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.date DESC, s.start_time DESC, b.id DESC LIMIT ?`)
      .bind(...params, limit).all();
    return c.json({ bookings: res.results });
  },
);

bookings.get('/:id', requireRole(...COMMITTEE_VIEW), async (c) => {
  const row = await c.env.DB.prepare(`${BOOKING_LIST_SQL} WHERE b.id = ?`).bind(parseId(c.req.param('id'))).first();
  if (!row) fail(404, 'Booking not found');
  return c.json({ booking: row });
});

bookings.post(
  '/',
  requireRole(...BOOKING_MANAGERS),
  zv('json', z.object({
    vendorId: z.number().int().positive(),
    sizeId: z.number().int().positive(),
    count: z.number().int().min(1).max(5),
    date: zDate,
    slotId: z.number().int().positive(),
    targetTankId: z.number().int().positive(),
    notes: zOptionalText(500),
  })),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = currentUser(c);
    const today = istDate();
    if (body.date < today) fail(400, 'Delivery date cannot be in the past.');
    if (body.date > addDays(today, 30)) fail(400, 'Bookings can be made up to 30 days ahead.');

    const [society, vendor, size, slot, tank] = await Promise.all([
      getSociety(db),
      db.select().from(vendors).where(and(eq(vendors.id, body.vendorId), eq(vendors.isActive, true))).get(),
      db.select().from(tankerSizes).where(and(eq(tankerSizes.id, body.sizeId), eq(tankerSizes.isActive, true))).get(),
      db.select().from(deliverySlots).where(and(eq(deliverySlots.id, body.slotId), eq(deliverySlots.isActive, true))).get(),
      db.select().from(tanks).where(and(eq(tanks.id, body.targetTankId), eq(tanks.isActive, true))).get(),
    ]);
    if (!vendor) fail(400, 'Vendor not found or inactive.');
    if (!size) fail(400, 'Tanker size not available.');
    if (!slot) fail(400, 'Delivery slot not available.');
    if (!tank) fail(400, 'Target tank not found.');

    const cost = bookingCostPaise(vendor.ratePer10kPaise, size.litres, body.count);
    const needsApproval = cost > society.approvalLimitPaise;
    const [created] = await db
      .insert(tankerBookings)
      .values({
        // Codes run TK-1001, TK-1002, … — computed inside the INSERT so concurrent bookings can't collide.
        code: sql`(SELECT 'TK-' || (1001 + COALESCE(MAX(id), 0)) FROM tanker_bookings)`,
        vendorId: vendor.id, sizeId: size.id, sizeLitres: size.litres, count: body.count, date: body.date,
        slotId: slot.id, targetTankId: tank.id, status: needsApproval ? 'pending_approval' : 'confirmed',
        ratePer10kPaise: vendor.ratePer10kPaise, costPaise: cost, notes: body.notes, bookedBy: user.id,
      })
      .returning();
    await auditQuery(c, { action: 'create', entity: 'booking', entityId: created.id, after: created });
    const month = await monthTotals(c.env.DB, monthOf(body.date));
    return c.json({
      booking: created,
      needsApproval,
      costPerFlatPaise: costPerFlatPaise(cost, society.flatsCount),
      budgetLeftPaise: society.monthlyBudgetPaise - month.spentPaise - month.committedPaise,
    }, 201);
  },
);

async function transition(
  c: Context<AppEnv>,
  from: string[],
  to: 'confirmed' | 'rejected' | 'cancelled' | 'on_the_way',
  extra: Partial<typeof tankerBookings.$inferInsert> = {},
  action: string = to,
) {
  const db = c.get('db');
  const id = parseId(c.req.param('id') ?? '');
  const before = await db.select().from(tankerBookings).where(eq(tankerBookings.id, id)).get();
  if (!before) fail(404, 'Booking not found');
  if (!from.includes(before.status)) fail(409, `Booking ${before.code} is ${before.status.replace(/_/g, ' ')} and cannot be changed to ${to.replace(/_/g, ' ')}.`);
  const patch = { status: to, updatedAt: nowIso(), ...extra };
  await db.batch([
    db.update(tankerBookings).set(patch).where(eq(tankerBookings.id, id)),
    auditQuery(c, { action, entity: 'booking', entityId: id, before: { status: before.status }, after: patch }),
  ]);
  return c.json({ ok: true, booking: { ...before, ...patch } });
}

bookings.post('/:id/approve', requireRole(...APPROVERS), (c) =>
  transition(c, ['pending_approval'], 'confirmed', { approvedBy: currentUser(c).id, approvedAt: nowIso() }, 'approve'));

bookings.post('/:id/reject', requireRole(...APPROVERS), (c) =>
  transition(c, ['pending_approval'], 'rejected', { approvedBy: currentUser(c).id, approvedAt: nowIso() }, 'reject'));

bookings.post('/:id/cancel', requireRole(...BOOKING_MANAGERS), (c) =>
  transition(c, ['pending_approval', 'confirmed', 'on_the_way'], 'cancelled', {}, 'cancel'));

bookings.post(
  '/:id/dispatch',
  requireRole(...BOOKING_MANAGERS),
  zv('json', z.object({ etaMinutes: z.number().int().min(5).max(600) })),
  (c) => transition(c, ['confirmed'], 'on_the_way', { etaAt: new Date(Date.now() + c.req.valid('json').etaMinutes * 60_000).toISOString() }, 'dispatch'),
);

export default bookings;
