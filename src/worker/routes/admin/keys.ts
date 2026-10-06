import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../../env';
import { apiKeys } from '../../db/schema';
import { generateToken, sha256Hex } from '../../lib/crypto';
import { auditQuery } from '../../lib/audit';
import { currentUser, fail, nowIso, parseId } from '../../lib/http';
import { zv } from '../../lib/validate';

// Sensor API keys — super admin only (enforced in admin/index.ts).
const keys = new Hono<AppEnv>();

keys.get('/', async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT k.id, k.name, k.prefix, k.scope, k.tank_id, t.name AS tank, k.last_used_at, k.revoked_at, k.created_at, u.name AS created_by
     FROM api_keys k LEFT JOIN tanks t ON t.id = k.tank_id LEFT JOIN users u ON u.id = k.created_by
     ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
  ).all();
  return c.json({ items: res.results });
});

/** Creates a key and returns it ONCE. Only its SHA-256 hash is stored. */
keys.post('/', zv('json', z.object({ name: z.string().trim().min(1).max(80), tankId: z.number().int().positive().nullable().optional() })), async (c) => {
  const { name, tankId } = c.req.valid('json');
  const key = `js_live_${generateToken(24)}`;
  const db = c.get('db');
  const [row] = await db.insert(apiKeys).values({
    name, tankId: tankId ?? null, prefix: key.slice(0, 12), keyHash: await sha256Hex(key), createdBy: currentUser(c).id,
  }).returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix });
  await auditQuery(c, { action: 'create', entity: 'api_key', entityId: row.id, after: { name, tankId, prefix: row.prefix } });
  return c.json({ item: row, key }, 201);
});

keys.post('/:id/revoke', async (c) => {
  const id = parseId(c.req.param('id'));
  const db = c.get('db');
  const before = await db.select({ id: apiKeys.id, name: apiKeys.name, revokedAt: apiKeys.revokedAt }).from(apiKeys).where(eq(apiKeys.id, id)).get();
  if (!before) fail(404, 'Key not found');
  if (before.revokedAt) fail(409, 'Key is already revoked');
  await db.batch([
    db.update(apiKeys).set({ revokedAt: nowIso() }).where(eq(apiKeys.id, id)),
    auditQuery(c, { action: 'revoke', entity: 'api_key', entityId: id, before }),
  ]);
  return c.json({ ok: true });
});

export default keys;
