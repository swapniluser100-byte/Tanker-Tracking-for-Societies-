import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { societies, users } from '../db/schema';
import { hashPassword, timingSafeEqualStr } from '../lib/crypto';
import { auditQuery } from '../lib/audit';
import { clientIp, fail, runBatch } from '../lib/http';
import type { BatchItem } from 'drizzle-orm/batch';
import { rateLimit } from '../lib/ratelimit';
import { zv, zName } from '../lib/validate';
import { passwordProblem } from '../../shared/roles';

/**
 * One-time first-run setup: creates the society (if missing) and the first super admin.
 * Only works while there is no super admin. In production it also requires the
 * ADMIN_BOOTSTRAP_TOKEN secret, so a freshly deployed app cannot be claimed by a stranger.
 * The same endpoint is used by `npm run admin:create` (scripts/create-admin.ts).
 */
const setup = new Hono<AppEnv>();

async function hasSuperAdmin(c: { get: (k: 'db') => AppEnv['Variables']['db'] }) {
  const row = await c.get('db').select({ n: sql<number>`count(*)` }).from(users).where(eq(users.role, 'super_admin')).get();
  return (row?.n ?? 0) > 0;
}

setup.get('/status', async (c) => {
  const needsSetup = !(await hasSuperAdmin(c));
  const society = await c.get('db').select({ id: societies.id }).from(societies).get();
  const tokenConfigured = Boolean(c.env.ADMIN_BOOTSTRAP_TOKEN);
  return c.json({
    needsSetup,
    needsSociety: !society,
    tokenRequired: tokenConfigured || c.env.APP_ENV !== 'development',
    setupDisabled: !tokenConfigured && c.env.APP_ENV !== 'development',
  });
});

setup.post(
  '/',
  zv('json', z.object({
    token: z.string().max(256).optional(),
    name: zName,
    email: z.email().max(160).transform((s) => s.toLowerCase()),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, '3–40 letters, digits, dot, dash or underscore'),
    password: z.string().max(128),
    society: z.object({
      name: zName,
      area: zName,
      city: z.string().trim().min(1).max(60).default('Pune'),
      flatsCount: z.number().int().min(1).max(10000),
    }).optional(),
  })),
  async (c) => {
    if (!(await rateLimit(c.env, 'setup', clientIp(c) ?? 'unknown', 10, 600))) fail(429, 'Too many attempts. Try again later.');
    const body = c.req.valid('json');
    const expected = c.env.ADMIN_BOOTSTRAP_TOKEN;
    if (expected) {
      const supplied = body.token ?? c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (!timingSafeEqualStr(supplied, expected)) fail(403, 'Setup token is incorrect.');
    } else if (c.env.APP_ENV !== 'development') {
      fail(503, 'Setup is disabled. Set the ADMIN_BOOTSTRAP_TOKEN secret with `wrangler secret put ADMIN_BOOTSTRAP_TOKEN`.');
    }
    if (await hasSuperAdmin(c)) fail(409, 'Setup has already been completed.');
    const problem = passwordProblem('super_admin', body.password);
    if (problem) fail(400, problem);

    const db = c.get('db');
    const existingSociety = await db.select({ id: societies.id }).from(societies).get();
    if (!existingSociety && !body.society) fail(400, 'Society details are required on first setup.');

    const { hash, salt } = await hashPassword(body.password);
    const writes: BatchItem<'sqlite'>[] = [];
    if (!existingSociety && body.society) writes.push(db.insert(societies).values({ ...body.society }));
    writes.push(db.insert(users).values({ name: body.name, email: body.email, username: body.username, passwordHash: hash, salt, role: 'super_admin' }));
    writes.push(auditQuery(c, { action: 'setup', entity: 'user', after: { name: body.name, email: body.email, username: body.username }, userId: null }));
    try {
      await runBatch(db, writes);
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, 'That email or username is already in use.');
      throw e;
    }
    return c.json({ ok: true });
  },
);

export default setup;
