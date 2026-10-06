import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireRole } from '../middleware/auth';
import { COMMITTEE_VIEW } from '../../shared/roles';
import { costPerFlatPaise } from '../../shared/calc';
import { istDate } from '../../shared/format';
import { getSetting, getSociety, monthOf, monthTotals, mostReliableVendorId, municipalSummary, spendSeries, storageSummary, tankStatuses, vendorStats } from '../lib/stats';

const dashboard = new Hono<AppEnv>();
dashboard.use('*', requireRole(...COMMITTEE_VIEW));

/** Header details for the committee app shell. */
dashboard.get('/society', async (c) => {
  const s = await getSociety(c.get('db'));
  return c.json({ society: { name: s.name, area: s.area, city: s.city, flatsCount: s.flatsCount } });
});

/** Everything the committee dashboard needs in one round trip. */
dashboard.get('/', async (c) => {
  const db = c.get('db');
  const d1 = c.env.DB;
  const today = istDate();
  const ym = monthOf(today);

  const [society, tanks, month, series, vendors, municipal, releaseTimings, todayRes, alertsRes, countsRes] = await Promise.all([
    getSociety(db),
    tankStatuses(d1),
    monthTotals(d1, ym),
    spendSeries(d1, 6),
    vendorStats(d1, true),
    municipalSummary(d1),
    getSetting<{ start: string; end: string }[]>(db, 'water_release_timings', []),
    d1.prepare(
      `SELECT b.id, b.code, b.status, b.count, b.size_litres, b.cost_paise, b.final_cost_paise, b.eta_at,
              v.name AS vendor, s.label AS slot_label, s.start_time, s.end_time, t.name AS tank,
              c.vehicle_number, c.litres_received, c.short_by_litres, c.on_time, c.photo_key, c.arrived_at
       FROM tanker_bookings b
       JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN delivery_slots s ON s.id = b.slot_id
       LEFT JOIN tanks t ON t.id = b.target_tank_id
       LEFT JOIN delivery_checkins c ON c.booking_id = b.id
       WHERE b.date = ? AND b.status NOT IN ('rejected')
       ORDER BY s.start_time, b.id`,
    ).bind(today).all(),
    d1.prepare(`SELECT id, type, message, booking_id, created_at FROM alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 20`).all(),
    d1.prepare(
      `SELECT (SELECT COUNT(*) FROM tanker_bookings WHERE status = 'pending_approval') AS pending_approvals,
              (SELECT COUNT(*) FROM complaints WHERE status != 'resolved') AS open_complaints`,
    ).first<{ pending_approvals: number; open_complaints: number }>(),
  ]);

  return c.json({
    society: {
      name: society.name, area: society.area, city: society.city, flatsCount: society.flatsCount,
      monthlyBudgetPaise: society.monthlyBudgetPaise, approvalLimitPaise: society.approvalLimitPaise,
      shortToleranceLitres: society.shortToleranceLitres,
    },
    today,
    storage: storageSummary(tanks),
    tanks,
    month: {
      ym,
      ...month,
      budgetPaise: society.monthlyBudgetPaise,
      costPerFlatPaise: costPerFlatPaise(month.spentPaise, society.flatsCount),
    },
    spendSeries: series,
    vendors,
    mostReliableVendorId: mostReliableVendorId(vendors),
    municipal,
    releaseTimings,
    todayTankers: todayRes.results,
    alerts: alertsRes.results,
    pendingApprovals: countsRes?.pending_approvals ?? 0,
    openComplaints: countsRes?.open_complaints ?? 0,
  });
});

export default dashboard;
