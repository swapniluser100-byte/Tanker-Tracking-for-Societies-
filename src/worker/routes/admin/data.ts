import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { requireRole } from '../../middleware/auth';
import { SUPER_ONLY } from '../../../shared/roles';
import { istDate } from '../../../shared/format';
import { auditQuery } from '../../lib/audit';
import { csvResponse, toCsv } from '../../lib/http';
import { zv } from '../../lib/validate';

// CSV exports and full JSON backup. Mounted under /api/admin/data.
const data = new Hono<AppEnv>();

const range = zv('query', z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}));

data.get('/bookings.csv', range, async (c) => {
  const { from = '2000-01-01', to = '2999-12-31' } = c.req.valid('query');
  const res = await c.env.DB.prepare(
    `SELECT b.code, b.date, s.label AS slot, v.name AS vendor, b.size_litres, b.count, t.name AS target_tank, b.status,
            b.rate_per_10k_paise / 100.0 AS rate_per_10k_rupees, b.cost_paise / 100.0 AS estimated_cost_rupees,
            b.final_cost_paise / 100.0 AS final_cost_rupees, c.vehicle_number, c.level_before_pct, c.level_after_pct,
            c.litres_received, c.short_by_litres, c.on_time, c.arrived_at, ub.name AS booked_by, ua.name AS approved_by, b.created_at
     FROM tanker_bookings b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN delivery_slots s ON s.id = b.slot_id
     LEFT JOIN tanks t ON t.id = b.target_tank_id LEFT JOIN delivery_checkins c ON c.booking_id = b.id
     LEFT JOIN users ub ON ub.id = b.booked_by LEFT JOIN users ua ON ua.id = b.approved_by
     WHERE b.date BETWEEN ? AND ? ORDER BY b.date, b.id`,
  ).bind(from, to).all<Record<string, unknown>>();
  await auditQuery(c, { action: 'export', entity: 'bookings', after: { from, to, rows: res.results.length } });
  return csvResponse(`jalsetu-bookings-${istDate()}.csv`, toCsv(res.results));
});

data.get('/expenses.csv', range, async (c) => {
  const { from = '2000-01-01', to = '2999-12-31' } = c.req.valid('query');
  const res = await c.env.DB.prepare(
    `SELECT e.paid_date, e.description, v.name AS vendor, b.code AS booking, e.amount_paise / 100.0 AS amount_rupees,
            e.payment_mode, e.reference, u.name AS recorded_by, e.created_at
     FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN tanker_bookings b ON b.id = e.booking_id LEFT JOIN users u ON u.id = e.created_by
     WHERE e.paid_date BETWEEN ? AND ? ORDER BY e.paid_date, e.id`,
  ).bind(from, to).all<Record<string, unknown>>();
  await auditQuery(c, { action: 'export', entity: 'expenses', after: { from, to, rows: res.results.length } });
  return csvResponse(`jalsetu-expenses-${istDate()}.csv`, toCsv(res.results));
});

data.get('/readings.csv', range, async (c) => {
  const { from, to } = c.req.valid('query');
  const fromIso = new Date(`${from ?? istDate(new Date(Date.now() - 30 * 86_400_000))}T00:00:00+05:30`).toISOString();
  const toIso = new Date(new Date(`${to ?? istDate()}T00:00:00+05:30`).getTime() + 86_400_000).toISOString();
  const res = await c.env.DB.prepare(
    `SELECT r.created_at, t.name AS tank, r.level_pct, r.litres, r.source FROM tank_readings r JOIN tanks t ON t.id = r.tank_id
     WHERE r.created_at >= ? AND r.created_at < ? ORDER BY r.created_at, t.name`,
  ).bind(fromIso, toIso).all<Record<string, unknown>>();
  await auditQuery(c, { action: 'export', entity: 'tank_readings', after: { from: fromIso, to: toIso, rows: res.results.length } });
  return csvResponse(`jalsetu-readings-${istDate()}.csv`, toCsv(res.results));
});

/** Full JSON backup (super admin only). Password hashes, salts, session tokens, API key hashes and the upload signing key are excluded. */
data.get('/backup.json', requireRole(...SUPER_ONLY), async (c) => {
  const d1 = c.env.DB;
  const tables: Record<string, string> = {
    societies: 'SELECT * FROM societies',
    wings: 'SELECT * FROM wings',
    flats: 'SELECT * FROM flats',
    users: `SELECT id, name, email, username, phone, role, flat_id, is_active, must_reset_password, last_login_at, created_at, updated_at FROM users`,
    tanks: 'SELECT * FROM tanks',
    tank_readings: 'SELECT * FROM tank_readings',
    vendors: 'SELECT * FROM vendors',
    tanker_sizes: 'SELECT * FROM tanker_sizes',
    delivery_slots: 'SELECT * FROM delivery_slots',
    tanker_bookings: 'SELECT * FROM tanker_bookings',
    delivery_checkins: 'SELECT * FROM delivery_checkins',
    municipal_schedule: 'SELECT * FROM municipal_schedule',
    municipal_supply_logs: 'SELECT * FROM municipal_supply_logs',
    expenses: 'SELECT * FROM expenses',
    notices: 'SELECT * FROM notices',
    complaints: 'SELECT * FROM complaints',
    alerts: 'SELECT * FROM alerts',
    notification_templates: 'SELECT * FROM notification_templates',
    api_keys: 'SELECT id, name, prefix, scope, tank_id, last_used_at, revoked_at, created_by, created_at FROM api_keys',
    audit_logs: 'SELECT * FROM audit_logs',
    settings: "SELECT * FROM settings WHERE key != 'upload_signing_secret'",
  };
  const names = Object.keys(tables);
  const results = await d1.batch(names.map((n) => d1.prepare(tables[n])));
  const backup = {
    app: 'JalSetu', version: 1, exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(names.map((n, i) => [n, results[i].results])),
  };
  await auditQuery(c, { action: 'export', entity: 'backup', after: { tables: names.length } });
  return new Response(JSON.stringify(backup, null, 1), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="jalsetu-backup-${istDate()}.json"`, 'Cache-Control': 'no-store' },
  });
});

export default data;
