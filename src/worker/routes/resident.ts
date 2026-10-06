import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import type { AppEnv, DB } from '../env';
import { complaints, flats, notices, wings } from '../db/schema';
import { requireRole } from '../middleware/auth';
import { costPerFlatPaise } from '../../shared/calc';
import { istDate, istTime } from '../../shared/format';
import { auditQuery } from '../lib/audit';
import { currentUser, fail } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { zOptionalText, zv } from '../lib/validate';
import { getSetting, getSociety, monthOf, monthTotals, municipalSummary, spendSeries, tankStatuses } from '../lib/stats';

const resident = new Hono<AppEnv>();
// Staff can open the resident view too (useful for checking what residents see).
resident.use('*', requireRole('resident', 'super_admin', 'committee_admin', 'treasurer'));

type Window = { start: string; end: string };

/** Is water released to flats right now, and until when / from when. */
export function waterStatus(windows: Window[], nowHHMM: string, tankPct: number | null) {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  const current = sorted.find((w) => w.start <= nowHHMM && nowHHMM < w.end);
  const tankEmpty = tankPct !== null && tankPct < 3;
  if (current && !tankEmpty) return { on: true, until: current.end, nextStart: null as string | null, tankEmpty };
  const next = sorted.find((w) => w.start > nowHHMM) ?? sorted[0] ?? null;
  return { on: false, until: null as string | null, nextStart: next?.start ?? null, nextIsTomorrow: next ? next.start <= nowHHMM : false, tankEmpty };
}

async function myFlat(db: DB, flatId: number | null) {
  if (!flatId) return null;
  return (await db.select({ id: flats.id, number: flats.number, wingId: wings.id, wing: wings.name }).from(flats).innerJoin(wings, eq(wings.id, flats.wingId)).where(eq(flats.id, flatId)).get()) ?? null;
}

async function activeNotices(db: DB, limit: number) {
  return db.select().from(notices).where(or(isNull(notices.expiresAt), gte(notices.expiresAt, istDate()))).orderBy(desc(notices.createdAt)).limit(limit);
}

resident.get('/home', async (c) => {
  const db = c.get('db');
  const d1 = c.env.DB;
  const user = currentUser(c);
  const today = istDate();
  const [flat, society, tanksList, municipal, timings, month, tankersRes, noticeRows] = await Promise.all([
    myFlat(db, user.flatId),
    getSociety(db),
    tankStatuses(d1),
    municipalSummary(d1),
    getSetting<Window[]>(db, 'water_release_timings', []),
    monthTotals(d1, monthOf(today)),
    d1.prepare(
      `SELECT b.code, b.status, b.count, b.size_litres, b.eta_at, s.start_time, s.end_time
       FROM tanker_bookings b LEFT JOIN delivery_slots s ON s.id = b.slot_id
       WHERE b.date = ? AND b.status IN ('confirmed','on_the_way') ORDER BY CASE b.status WHEN 'on_the_way' THEN 0 ELSE 1 END, s.start_time`,
    ).bind(today).all(),
    activeNotices(db, 3),
  ]);
  const overhead = tanksList.find((t) => t.type === 'overhead' && flat && t.wingId === flat.wingId) ?? tanksList.find((t) => t.type === 'overhead') ?? null;
  const sump = tanksList.find((t) => t.type === 'sump') ?? null;
  const todaysSchedule = municipal.week.filter((s) => s.date === today);
  return c.json({
    flat: flat ? { label: `${flat.wing}-${flat.number}`, wing: flat.wing } : null,
    society: { name: society.name, area: society.area },
    water: waterStatus(timings, istTime(), overhead?.levelPct ?? null),
    overhead: overhead && { name: overhead.name, levelPct: overhead.levelPct, hoursLeft: overhead.hoursLeft, isLow: overhead.isLow },
    sump: sump && { levelPct: sump.levelPct, hoursLeft: sump.hoursLeft },
    releaseTimings: timings,
    municipal: { today: todaysSchedule, todayLog: municipal.todayLog, next: municipal.next },
    tankers: tankersRes.results,
    myShare: { month: month, perFlatPaise: costPerFlatPaise(month.spentPaise, society.flatsCount) },
    notices: noticeRows,
  });
});

resident.get('/schedule', async (c) => {
  const db = c.get('db');
  const [municipal, timings] = await Promise.all([municipalSummary(c.env.DB), getSetting<Window[]>(db, 'water_release_timings', [])]);
  return c.json({ releaseTimings: timings, municipal: { week: municipal.week, recentLogs: municipal.recentLogs, cameRatePct: municipal.cameRatePct, avgDelayMinutes: municipal.avgDelayMinutes } });
});

resident.get('/costs', async (c) => {
  const db = c.get('db');
  const society = await getSociety(db);
  const [month, series] = await Promise.all([monthTotals(c.env.DB, monthOf()), spendSeries(c.env.DB, 6)]);
  return c.json({
    flatsCount: society.flatsCount,
    month: { ...month, perFlatPaise: costPerFlatPaise(month.spentPaise, society.flatsCount) },
    series: series.map((s) => ({ ...s, perFlatPaise: costPerFlatPaise(s.spentPaise, society.flatsCount) })),
  });
});

resident.get('/notices', async (c) => c.json({ notices: await activeNotices(c.get('db'), 50) }));

resident.get('/complaints', async (c) => {
  const rows = await c.get('db').select().from(complaints).where(eq(complaints.userId, currentUser(c).id)).orderBy(desc(complaints.createdAt)).limit(20);
  return c.json({ complaints: rows });
});

resident.post(
  '/complaints',
  zv('json', z.object({ type: z.enum(['no_water', 'leakage', 'other']), description: zOptionalText(500) })),
  async (c) => {
    const user = currentUser(c);
    if (!(await rateLimit(c.env, 'complaint', String(user.id), 10, 3600))) fail(429, 'Too many reports in the last hour.');
    const body = c.req.valid('json');
    const db = c.get('db');
    // Avoid duplicate open reports of the same type from the same flat.
    if (user.flatId) {
      const dupe = await db.select({ id: complaints.id }).from(complaints)
        .where(and(eq(complaints.flatId, user.flatId), eq(complaints.type, body.type), eq(complaints.status, 'open'))).get();
      if (dupe) return c.json({ ok: true, duplicate: true, id: dupe.id });
    }
    const [row] = await db.insert(complaints).values({ type: body.type, description: body.description, flatId: user.flatId, userId: user.id }).returning();
    await auditQuery(c, { action: 'create', entity: 'complaint', entityId: row.id, after: row });
    return c.json({ ok: true, id: row.id }, 201);
  },
);

export default resident;
