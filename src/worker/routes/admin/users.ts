import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import type { AppEnv } from '../../env';
import { sessions, users } from '../../db/schema';
import { hashPassword } from '../../lib/crypto';
import { auditQuery } from '../../lib/audit';
import { currentUser, fail, nowIso, parseId, runBatch } from '../../lib/http';
import type { BatchItem } from 'drizzle-orm/batch';
import { revokeAllSessionsQuery } from '../../lib/session';
import { zPhone, zv } from '../../lib/validate';
import { passwordProblem, type Role } from '../../../shared/roles';

// Mounted under /api/admin — super admin only (enforced in admin/index.ts).
const usersRoutes = new Hono<AppEnv>();

const ROLE = z.enum(['super_admin', 'committee_admin', 'treasurer', 'guard', 'resident']);
const optionalEmail = z.email().max(160).transform((s) => s.toLowerCase()).nullable().optional().or(z.literal('').transform(() => null));
const optionalUsername = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, '3–40 letters, digits, dot, dash or underscore').nullable().optional().or(z.literal('').transform(() => null));
const optionalPhone = zPhone.nullable().optional().or(z.literal('').transform(() => null));

const PUBLIC_COLUMNS = `u.id, u.name, u.email, u.username, u.phone, u.role, u.flat_id, u.is_active, u.failed_attempts,
  u.locked_until, u.must_reset_password, u.last_login_at, u.created_at, w.name || '-' || f.number AS flat`;

usersRoutes.get('/users', async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT ${PUBLIC_COLUMNS}, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active_sessions
     FROM users u LEFT JOIN flats f ON f.id = u.flat_id LEFT JOIN wings w ON w.id = f.wing_id
     ORDER BY CASE u.role WHEN 'super_admin' THEN 0 WHEN 'committee_admin' THEN 1 WHEN 'treasurer' THEN 2 WHEN 'guard' THEN 3 ELSE 4 END, u.name`,
  ).bind(nowIso()).all();
  return c.json({ items: res.results });
});

function checkIdentity(role: Role, v: { email?: string | null; username?: string | null; phone?: string | null }) {
  if (!v.email && !v.username && !v.phone) fail(400, 'Give at least an email, username or phone number to log in with.');
  if ((role === 'guard' || role === 'resident') && !v.phone) fail(400, 'Guards and residents log in with their phone number — please add it.');
}

usersRoutes.post(
  '/users',
  zv('json', z.object({
    name: z.string().trim().min(1).max(120),
    email: optionalEmail,
    username: optionalUsername,
    phone: optionalPhone,
    role: ROLE,
    flatId: z.number().int().positive().nullable().optional(),
    password: z.string().max(128),
    mustResetPassword: z.boolean().default(true),
  })),
  async (c) => {
    const body = c.req.valid('json');
    checkIdentity(body.role, body);
    const problem = passwordProblem(body.role, body.password);
    if (problem) fail(400, problem);
    const { hash, salt } = await hashPassword(body.password);
    const db = c.get('db');
    try {
      const [row] = await db.insert(users).values({
        name: body.name, email: body.email ?? null, username: body.username ?? null, phone: body.phone ?? null, role: body.role,
        flatId: body.flatId ?? null, passwordHash: hash, salt, mustResetPassword: body.mustResetPassword,
      }).returning({ id: users.id, name: users.name, role: users.role });
      await auditQuery(c, { action: 'create', entity: 'user', entityId: row.id, after: { ...body, password: undefined } });
      return c.json({ item: row }, 201);
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, 'That email, username or phone is already used by another account.');
      throw e;
    }
  },
);

async function countActiveSuperAdmins(c: { get: (k: 'db') => AppEnv['Variables']['db'] }, excludeId: number) {
  const r = await c.get('db').select({ n: sql<number>`count(*)` }).from(users)
    .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true), ne(users.id, excludeId))).get();
  return r?.n ?? 0;
}

usersRoutes.put(
  '/users/:id',
  zv('json', z.object({
    name: z.string().trim().min(1).max(120),
    email: optionalEmail,
    username: optionalUsername,
    phone: optionalPhone,
    role: ROLE,
    flatId: z.number().int().positive().nullable().optional(),
    isActive: z.boolean(),
  })),
  async (c) => {
    const id = parseId(c.req.param('id'));
    const me = currentUser(c);
    const body = c.req.valid('json');
    const db = c.get('db');
    const before = await db.select().from(users).where(eq(users.id, id)).get();
    if (!before) fail(404, 'User not found');
    checkIdentity(body.role, body);
    if (id === me.id && (!body.isActive || body.role !== 'super_admin')) fail(400, 'You cannot deactivate or demote your own account.');
    if (before.role === 'super_admin' && (body.role !== 'super_admin' || !body.isActive) && (await countActiveSuperAdmins(c, id)) === 0)
      fail(400, 'There must always be at least one active super admin.');
    const patch = {
      name: body.name, email: body.email ?? null, username: body.username ?? null, phone: body.phone ?? null,
      role: body.role, flatId: body.flatId ?? null, isActive: body.isActive, updatedAt: nowIso(),
    };
    const writes: BatchItem<'sqlite'>[] = [
      db.update(users).set(patch).where(eq(users.id, id)),
      auditQuery(c, { action: 'update', entity: 'user', entityId: id, before, after: patch }),
    ];
    // Role changes and deactivation take effect immediately: sign the user out everywhere.
    if (!body.isActive || body.role !== before.role) writes.push(revokeAllSessionsQuery(c, id));
    try {
      await runBatch(db, writes);
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, 'That email, username or phone is already used by another account.');
      throw e;
    }
    return c.json({ ok: true });
  },
);

/** Sets a temporary password and forces the user to change it at next login. */
usersRoutes.post('/users/:id/reset-password', zv('json', z.object({ temporaryPassword: z.string().max(128) })), async (c) => {
  const id = parseId(c.req.param('id'));
  const db = c.get('db');
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (!user) fail(404, 'User not found');
  const pw = c.req.valid('json').temporaryPassword;
  const problem = passwordProblem(user.role, pw);
  if (problem) fail(400, problem);
  const { hash, salt } = await hashPassword(pw);
  await db.batch([
    db.update(users).set({ passwordHash: hash, salt, mustResetPassword: true, failedAttempts: 0, lockedUntil: null, updatedAt: nowIso() }).where(eq(users.id, id)),
    revokeAllSessionsQuery(c, id),
    auditQuery(c, { action: 'reset_password', entity: 'user', entityId: id }),
  ]);
  return c.json({ ok: true });
});

/** Forces a password change at the user's next request (their current password keeps working for that change). */
usersRoutes.post('/users/:id/force-reset', async (c) => {
  const id = parseId(c.req.param('id'));
  const db = c.get('db');
  await db.batch([
    db.update(users).set({ mustResetPassword: true, updatedAt: nowIso() }).where(eq(users.id, id)),
    auditQuery(c, { action: 'force_password_reset', entity: 'user', entityId: id }),
  ]);
  return c.json({ ok: true });
});

usersRoutes.post('/users/:id/unlock', async (c) => {
  const id = parseId(c.req.param('id'));
  const db = c.get('db');
  await db.batch([
    db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, id)),
    auditQuery(c, { action: 'unlock', entity: 'user', entityId: id }),
  ]);
  return c.json({ ok: true });
});

usersRoutes.post('/users/:id/revoke-sessions', async (c) => {
  const id = parseId(c.req.param('id'));
  await c.get('db').batch([revokeAllSessionsQuery(c, id), auditQuery(c, { action: 'revoke_sessions', entity: 'user', entityId: id })]);
  return c.json({ ok: true });
});

usersRoutes.get('/sessions', async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, u.name, u.role, s.ip, s.user_agent, s.created_at, s.last_seen_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? ORDER BY s.last_seen_at DESC LIMIT 500`,
  ).bind(nowIso()).all();
  return c.json({ items: res.results, currentSessionId: c.get('sessionId') });
});

usersRoutes.delete('/sessions/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const db = c.get('db');
  const s = await db.select({ userId: sessions.userId }).from(sessions).where(and(eq(sessions.id, id), gt(sessions.expiresAt, nowIso()))).get();
  if (!s) fail(404, 'Session not found');
  await db.batch([db.delete(sessions).where(eq(sessions.id, id)), auditQuery(c, { action: 'revoke_session', entity: 'session', entityId: id, after: { userId: s.userId } })]);
  return c.json({ ok: true });
});

export default usersRoutes;
