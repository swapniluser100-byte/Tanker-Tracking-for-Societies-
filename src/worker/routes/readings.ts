import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { alerts, apiKeys, tankReadings, tanks } from '../db/schema';
import { sha256Hex } from '../lib/crypto';
import { fail, nowIso, runBatch } from '../lib/http';
import type { BatchItem } from 'drizzle-orm/batch';
import { rateLimit } from '../lib/ratelimit';
import { zv } from '../lib/validate';

/**
 * POST /api/readings — for IoT tank sensors (e.g. ESP32 + ultrasonic sensor).
 *   Authorization: Bearer <api key>
 *   { "tank_id": 1, "level_pct": 46.2 }        or
 *   { "tank_id": 1, "distance_cm": 132, "tank_height_cm": 250, "sensor_offset_cm": 20 }
 * Rate limited to 12 requests per minute per key.
 */
const readings = new Hono<AppEnv>();

readings.post(
  '/',
  zv('json', z.union([
    z.object({ tank_id: z.number().int().positive(), level_pct: z.number().min(0).max(100) }),
    z.object({
      tank_id: z.number().int().positive(),
      distance_cm: z.number().min(0).max(2000),
      tank_height_cm: z.number().positive().max(2000),
      sensor_offset_cm: z.number().min(0).max(500).default(0),
    }),
  ])),
  async (c) => {
    const key = c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!key || key.length > 200) fail(401, 'Missing API key');
    const db = c.get('db');
    const apiKey = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, await sha256Hex(key)), isNull(apiKeys.revokedAt))).get();
    if (!apiKey) fail(401, 'Invalid or revoked API key');
    if (!(await rateLimit(c.env, 'sensor', String(apiKey.id), 12, 60))) fail(429, 'Rate limit exceeded (12 readings per minute)');

    const body = c.req.valid('json');
    if (apiKey.tankId && apiKey.tankId !== body.tank_id) fail(403, 'This key is not allowed to report for that tank');
    const tank = await db.select().from(tanks).where(and(eq(tanks.id, body.tank_id), eq(tanks.isActive, true))).get();
    if (!tank) fail(404, 'Tank not found');

    let levelPct: number;
    if ('level_pct' in body) levelPct = body.level_pct;
    else {
      const waterHeight = body.tank_height_cm - (body.distance_cm - body.sensor_offset_cm);
      levelPct = Math.min(100, Math.max(0, (waterHeight / body.tank_height_cm) * 100));
    }
    levelPct = Math.round(levelPct * 10) / 10;
    const litres = Math.round((levelPct / 100) * tank.capacityLitres);
    const now = nowIso();

    const writes: BatchItem<'sqlite'>[] = [
      db.insert(tankReadings).values({ tankId: tank.id, levelPct, litres, source: 'sensor', apiKeyId: apiKey.id, createdAt: now }),
      db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, apiKey.id)),
    ];
    // Raise one low-level alert per tank per 6 hours.
    if (levelPct < tank.alertPct) {
      const recent = await db.select({ id: alerts.id }).from(alerts)
        .where(and(eq(alerts.type, 'low_tank'), gt(alerts.createdAt, new Date(Date.now() - 6 * 3600_000).toISOString()), eq(alerts.message, `${tank.name} below ${tank.alertPct}%`)))
        .get();
      if (!recent) writes.push(db.insert(alerts).values({ type: 'low_tank', message: `${tank.name} below ${tank.alertPct}%` }));
    }
    await runBatch(db, writes);
    return c.json({ ok: true, tank_id: tank.id, level_pct: levelPct, litres }, 201);
  },
);

export default readings;
