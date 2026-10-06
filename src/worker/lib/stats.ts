// Read-side aggregates shared by the committee dashboard, booking flow, guard and resident apps.
// These use raw D1 SQL where window functions / GROUP BY make Drizzle's builder awkward.
import { eq } from 'drizzle-orm';
import { societies, settings } from '../db/schema';
import type { DB } from '../env';
import { fail } from './http';
import { avgDailyUseFromReadings, hoursLeft } from '../../shared/calc';
import { addDays, istDate, istTime, istWeekday } from '../../shared/format';

export async function getSociety(db: DB) {
  const s = await db.select().from(societies).where(eq(societies.id, 1)).get() ?? (await db.select().from(societies).get());
  if (!s) fail(503, 'The society has not been set up yet.', 'NOT_SET_UP');
  return s;
}

export async function getSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

export interface TankStatus {
  id: number;
  name: string;
  type: 'sump' | 'overhead';
  capacityLitres: number;
  wingId: number | null;
  wingName: string | null;
  alertPct: number;
  levelPct: number | null;
  litres: number | null;
  readingAt: string | null;
  readingSource: string | null;
  avgDailyUseLitres: number;
  hoursLeft: number | null;
  isLow: boolean;
}

export async function tankStatuses(d1: D1Database): Promise<TankStatus[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [tanksRes, latestRes, seriesRes] = await d1.batch<Record<string, unknown>>([
    d1.prepare(`SELECT t.id, t.name, t.type, t.capacity_litres, t.wing_id, t.alert_pct, w.name AS wing_name
                FROM tanks t LEFT JOIN wings w ON w.id = t.wing_id WHERE t.is_active = 1 ORDER BY t.type DESC, t.name`),
    d1.prepare(`SELECT tank_id, level_pct, litres, created_at, source FROM (
                  SELECT r.*, ROW_NUMBER() OVER (PARTITION BY tank_id ORDER BY created_at DESC, id DESC) AS rn FROM tank_readings r
                ) WHERE rn = 1`),
    d1.prepare(`SELECT tank_id, litres, created_at FROM tank_readings WHERE created_at >= ? ORDER BY tank_id, created_at`).bind(since),
  ]);
  const latest = new Map(latestRes.results.map((r) => [r.tank_id as number, r]));
  const series = new Map<number, { litres: number; createdAt: string }[]>();
  for (const r of seriesRes.results) {
    const id = r.tank_id as number;
    if (!series.has(id)) series.set(id, []);
    series.get(id)!.push({ litres: r.litres as number, createdAt: r.created_at as string });
  }
  return tanksRes.results.map((t) => {
    const l = latest.get(t.id as number);
    const avg = avgDailyUseFromReadings(series.get(t.id as number) ?? []);
    const litres = l ? (l.litres as number) : null;
    const levelPct = l ? (l.level_pct as number) : null;
    return {
      id: t.id as number,
      name: t.name as string,
      type: t.type as 'sump' | 'overhead',
      capacityLitres: t.capacity_litres as number,
      wingId: (t.wing_id as number) ?? null,
      wingName: (t.wing_name as string) ?? null,
      alertPct: t.alert_pct as number,
      levelPct,
      litres,
      readingAt: l ? (l.created_at as string) : null,
      readingSource: l ? (l.source as string) : null,
      avgDailyUseLitres: Math.round(avg),
      hoursLeft: litres === null ? null : hoursLeft(litres, avg),
      isLow: levelPct !== null && levelPct < (t.alert_pct as number),
    };
  });
}

/** Totals across all tanks; hours left uses the combined 7-day average. */
export function storageSummary(tanks: TankStatus[]) {
  const capacity = tanks.reduce((a, t) => a + t.capacityLitres, 0);
  const litres = tanks.reduce((a, t) => a + (t.litres ?? 0), 0);
  const dailyUse = tanks.filter((t) => t.type === 'overhead').reduce((a, t) => a + t.avgDailyUseLitres, 0);
  return { capacity, litres, pct: capacity ? (litres / capacity) * 100 : 0, avgDailyUseLitres: dailyUse, hoursLeft: hoursLeft(litres, dailyUse) };
}

export const monthOf = (date = istDate()) => date.slice(0, 7);

export async function monthTotals(d1: D1Database, ym: string) {
  const r = await d1
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN b.status = 'delivered' THEN COALESCE(b.final_cost_paise, b.cost_paise) END), 0) AS spent,
         COALESCE(SUM(CASE WHEN b.status IN ('pending_approval','confirmed','on_the_way') THEN b.cost_paise END), 0) AS committed,
         COALESCE(SUM(CASE WHEN b.status = 'delivered' THEN b.count END), 0) AS tankers,
         COALESCE(SUM(c.litres_received), 0) AS litres_received,
         COALESCE(SUM(CASE WHEN c.short_by_litres > 0 THEN 1 END), 0) AS short_count,
         COALESCE(SUM(c.short_by_litres), 0) AS short_litres
       FROM tanker_bookings b LEFT JOIN delivery_checkins c ON c.booking_id = b.id
       WHERE substr(b.date, 1, 7) = ?`,
    )
    .bind(ym)
    .first<Record<string, number>>();
  return {
    spentPaise: r?.spent ?? 0,
    committedPaise: r?.committed ?? 0,
    tankers: r?.tankers ?? 0,
    litresReceived: r?.litres_received ?? 0,
    shortCount: r?.short_count ?? 0,
    shortLitres: r?.short_litres ?? 0,
  };
}

export async function spendSeries(d1: D1Database, months = 6) {
  const start = `${addDays(`${monthOf()}-01`, -31 * (months - 1)).slice(0, 7)}-01`;
  const res = await d1
    .prepare(
      `SELECT substr(date, 1, 7) AS month, SUM(COALESCE(final_cost_paise, cost_paise)) AS spent, SUM(count) AS tankers
       FROM tanker_bookings WHERE status = 'delivered' AND date >= ? GROUP BY month ORDER BY month`,
    )
    .bind(start)
    .all<{ month: string; spent: number; tankers: number }>();
  // Fill gaps so the chart always shows `months` bars.
  const out: { month: string; spentPaise: number; tankers: number }[] = [];
  let ym = monthOf();
  for (let i = 0; i < months; i++) {
    const row = res.results.find((r) => r.month === ym);
    out.unshift({ month: ym, spentPaise: row?.spent ?? 0, tankers: row?.tankers ?? 0 });
    ym = addDays(`${ym}-01`, -1).slice(0, 7);
  }
  return out;
}

export interface VendorStat {
  id: number;
  name: string;
  area: string;
  phone: string;
  upiId: string | null;
  ratePer10kPaise: number;
  isActive: boolean;
  trips: number;
  onTimePct: number | null;
  shortCount: number;
  shortPct: number | null;
  litresDelivered: number;
}

/** On-time % and short-delivery counts are derived from check-ins. */
export async function vendorStats(d1: D1Database, onlyActive = false): Promise<VendorStat[]> {
  const res = await d1
    .prepare(
      `SELECT v.id, v.name, v.area, v.phone, v.upi_id, v.rate_per_10k_paise, v.is_active,
              COUNT(c.id) AS trips, AVG(c.on_time) AS on_time, SUM(CASE WHEN c.short_by_litres > 0 THEN 1 ELSE 0 END) AS shorts,
              COALESCE(SUM(c.litres_received), 0) AS litres
       FROM vendors v
       LEFT JOIN tanker_bookings b ON b.vendor_id = v.id
       LEFT JOIN delivery_checkins c ON c.booking_id = b.id
       ${onlyActive ? 'WHERE v.is_active = 1' : ''}
       GROUP BY v.id ORDER BY v.is_active DESC, v.name`,
    )
    .all<Record<string, number | string | null>>();
  return res.results.map((r) => {
    const trips = Number(r.trips);
    return {
      id: Number(r.id),
      name: String(r.name),
      area: String(r.area),
      phone: String(r.phone),
      upiId: (r.upi_id as string) ?? null,
      ratePer10kPaise: Number(r.rate_per_10k_paise),
      isActive: Boolean(r.is_active),
      trips,
      onTimePct: trips ? Number(r.on_time) * 100 : null,
      shortCount: Number(r.shorts ?? 0),
      shortPct: trips ? (Number(r.shorts ?? 0) / trips) * 100 : null,
      litresDelivered: Number(r.litres),
    };
  });
}

/** Reliability score used to highlight the "most reliable" vendor: on-time % minus short %, needs 5+ trips. */
export function mostReliableVendorId(stats: VendorStat[]): number | null {
  const eligible = stats.filter((v) => v.isActive && v.trips >= 5);
  if (!eligible.length) return null;
  return eligible.reduce((best, v) => ((v.onTimePct ?? 0) - (v.shortPct ?? 0) > (best.onTimePct ?? 0) - (best.shortPct ?? 0) ? v : best)).id;
}

export interface MunicipalSlot {
  date: string;
  weekday: number;
  startTime: string;
  endTime: string;
  authority: string;
}

export async function municipalSummary(d1: D1Database) {
  const today = istDate();
  const since = addDays(today, -30);
  const [schedRes, logsRes] = await d1.batch<Record<string, unknown>>([
    d1.prepare(`SELECT weekday, start_time, end_time, authority FROM municipal_schedule WHERE is_active = 1 ORDER BY weekday, start_time`),
    d1.prepare(`SELECT date, came, actual_start, actual_end, delay_minutes, notes FROM municipal_supply_logs WHERE date >= ? ORDER BY date DESC`).bind(since),
  ]);
  const schedule = schedRes.results.map((r) => ({
    weekday: r.weekday as number, startTime: r.start_time as string, endTime: r.end_time as string, authority: r.authority as string,
  }));
  const logs = logsRes.results.map((r) => ({
    date: r.date as string, came: Boolean(r.came), actualStart: r.actual_start as string | null, actualEnd: r.actual_end as string | null,
    delayMinutes: r.delay_minutes as number | null, notes: r.notes as string | null,
  }));

  // Upcoming slots for the next 7 days (including today if not yet over).
  const nowTime = istTime();
  const week: MunicipalSlot[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    const wd = (istWeekday() + i) % 7;
    for (const s of schedule.filter((x) => x.weekday === wd)) week.push({ date, ...s });
  }
  const next = week.find((s) => s.date > today || s.endTime > nowTime) ?? null;
  const came = logs.filter((l) => l.came);
  const delays = came.map((l) => l.delayMinutes ?? 0);
  return {
    schedule,
    week,
    next,
    todayLog: logs.find((l) => l.date === today) ?? null,
    recentLogs: logs.slice(0, 10),
    cameRatePct: logs.length ? (came.length / logs.length) * 100 : null,
    avgDelayMinutes: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
    logsCount: logs.length,
  };
}
