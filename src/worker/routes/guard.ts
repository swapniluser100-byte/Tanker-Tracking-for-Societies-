import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { alerts, deliveryCheckins, deliverySlots, tankReadings, tankerBookings, tanks, vendors } from '../db/schema';
import { requireRole } from '../middleware/auth';
import { GUARD_APP } from '../../shared/roles';
import { evaluateDelivery, litresReceived, normaliseVehicleNumber, proRatedCostPaise } from '../../shared/calc';
import { addDays, istDate, istTime } from '../../shared/format';
import { auditQuery } from '../lib/audit';
import { currentUser, fail, nowIso, runBatch } from '../lib/http';
import type { BatchItem } from 'drizzle-orm/batch';
import { zOptionalText, zv } from '../lib/validate';
import { getSociety, tankStatuses } from '../lib/stats';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, signUpload } from '../lib/uploads';

const guard = new Hono<AppEnv>();
guard.use('*', requireRole(...GUARD_APP));

/** Today's expected tankers (plus anything from yesterday still not checked in) and today's completed ones. */
guard.get('/today', async (c) => {
  const today = istDate();
  const [res, tanksList, society] = await Promise.all([
    c.env.DB.prepare(
      `SELECT b.id, b.code, b.date, b.status, b.count, b.size_litres, b.target_tank_id, b.eta_at,
              v.name AS vendor, v.phone AS vendor_phone, s.label AS slot_label, s.start_time, s.end_time,
              c.vehicle_number, c.litres_received, c.short_by_litres, c.arrived_at
       FROM tanker_bookings b JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN delivery_slots s ON s.id = b.slot_id
       LEFT JOIN delivery_checkins c ON c.booking_id = b.id
       WHERE (b.date = ? AND b.status IN ('confirmed','on_the_way','delivered'))
          OR (b.date = ? AND b.status IN ('confirmed','on_the_way'))
       ORDER BY CASE b.status WHEN 'on_the_way' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, s.start_time`,
    ).bind(today, addDays(today, -1)).all(),
    tankStatuses(c.env.DB),
    getSociety(c.get('db')),
  ]);
  return c.json({ today, bookings: res.results, tanks: tanksList, toleranceLitres: society.shortToleranceLitres });
});

guard.post(
  '/uploads/sign',
  zv('json', z.object({
    contentType: z.string().refine((t) => t in ALLOWED_IMAGE_TYPES, 'Only JPEG, PNG or WebP images'),
    size: z.number().int().min(100).max(MAX_UPLOAD_BYTES, 'Photo must be 5 MB or smaller'),
  })),
  async (c) => {
    const { contentType, size } = c.req.valid('json');
    const key = `checkins/${istDate().slice(0, 7)}/${crypto.randomUUID()}.${ALLOWED_IMAGE_TYPES[contentType]}`;
    return c.json(await signUpload(c.env, key, contentType, size, currentUser(c).id));
  },
);

guard.post(
  '/checkins',
  zv('json', z.object({
    bookingId: z.number().int().positive(),
    vehicleNumber: z.string().max(20),
    levelBeforePct: z.number().min(0).max(100),
    levelAfterPct: z.number().min(0).max(100),
    photoKey: z.string().regex(/^checkins\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/).nullable().optional(),
    notes: zOptionalText(300),
  })),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = currentUser(c);

    const vehicle = normaliseVehicleNumber(body.vehicleNumber);
    if (!vehicle) fail(400, 'Enter the vehicle number like MH 12 AB 1234.');
    if (body.levelAfterPct <= body.levelBeforePct) fail(400, 'After-unloading level must be higher than the before level.');

    const row = await db
      .select({ booking: tankerBookings, tank: tanks, slot: deliverySlots, vendor: vendors })
      .from(tankerBookings)
      .innerJoin(tanks, eq(tanks.id, tankerBookings.targetTankId))
      .innerJoin(vendors, eq(vendors.id, tankerBookings.vendorId))
      .leftJoin(deliverySlots, eq(deliverySlots.id, tankerBookings.slotId))
      .where(eq(tankerBookings.id, body.bookingId))
      .get();
    if (!row) fail(404, 'Booking not found.');
    const { booking, tank, slot, vendor } = row;
    if (!['confirmed', 'on_the_way'].includes(booking.status)) fail(409, `${booking.code} is ${booking.status.replace(/_/g, ' ')} — it cannot be checked in.`);
    if (booking.date > istDate()) fail(409, `${booking.code} is booked for ${booking.date}, not today.`);
    if (body.photoKey && !(await c.env.PHOTOS.head(body.photoKey))) fail(400, 'Photo upload was not found. Please upload it again.');

    const society = await getSociety(db);
    const ordered = booking.sizeLitres * booking.count;
    const received = litresReceived(body.levelBeforePct, body.levelAfterPct, tank.capacityLitres);
    const result = evaluateDelivery(ordered, received, society.shortToleranceLitres);
    const finalCost = proRatedCostPaise(booking.costPaise, ordered, received, result.isShort);
    const now = nowIso();
    const onTime = booking.date < istDate() ? false : !slot || istTime() <= slot.endTime;

    const checkin = {
      bookingId: booking.id, vehicleNumber: vehicle, guardId: user.id, tankId: tank.id,
      levelBeforePct: body.levelBeforePct, levelAfterPct: body.levelAfterPct, litresOrdered: ordered, litresReceived: received,
      shortByLitres: result.shortByLitres, onTime, photoKey: body.photoKey ?? null, notes: body.notes, arrivedAt: now,
    };
    const writes: BatchItem<'sqlite'>[] = [
      db.insert(deliveryCheckins).values(checkin),
      db.update(tankerBookings).set({ status: 'delivered', finalCostPaise: finalCost, updatedAt: now }).where(eq(tankerBookings.id, booking.id)),
      db.insert(tankReadings).values({
        tankId: tank.id, levelPct: body.levelAfterPct, source: 'checkin', userId: user.id, createdAt: now,
        litres: Math.round((body.levelAfterPct / 100) * tank.capacityLitres),
      }),
      auditQuery(c, { action: 'checkin', entity: 'booking', entityId: booking.id, before: { status: booking.status }, after: { ...checkin, finalCostPaise: finalCost } }),
    ];
    if (result.isShort) {
      writes.push(db.insert(alerts).values({
        type: 'short_delivery', bookingId: booking.id,
        message: `${booking.code} from ${vendor.name} short by ${result.shortByLitres.toLocaleString('en-IN')} L (${vehicle})`,
      }));
    }
    // Check-in, booking status, tank reading, alert and audit commit together or not at all.
    try {
      await runBatch(db, writes);
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, `${booking.code} has already been checked in.`);
      throw e;
    }
    return c.json({
      ok: true, code: booking.code, litresOrdered: ordered, litresReceived: received,
      isShort: result.isShort, shortByLitres: result.shortByLitres, shortfall: result.shortfall,
      costPaise: booking.costPaise, finalCostPaise: finalCost, onTime,
    }, 201);
  },
);

export default guard;
