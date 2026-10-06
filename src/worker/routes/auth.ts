import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, ne, or } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { users, sessions, flats, wings } from '../db/schema';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { createSession, destroyCurrentSession, ensureCsrfCookie, revokeAllSessionsQuery } from '../lib/session';
import { auditQuery } from '../lib/audit';
import { clientIp, currentUser, fail, nowIso } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { verifyTurnstile } from '../lib/turnstile';
import { zv } from '../lib/validate';
import { requireSignedIn } from '../middleware/auth';
import { passwordProblem } from '../../shared/roles';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// A well-formed PBKDF2 hash that no password matches; verifying against it keeps the response time of
// "unknown user" the same as "wrong password", so usernames cannot be enumerated by timing.
const DUMMY = { hash: 'pbkdf2-sha256$100000$3Y0iXqA2m3e8m5b2kQx9q0m0K1dJtJr3v0o1qJ8q0kA=', salt: 'c2FsdHNhbHRzYWx0c2FsdA==' };

const auth = new Hono<AppEnv>();

auth.get('/config', (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY }));

/**
 * Login with email / username / phone + password (or PIN for guards and residents).
 * Credential checking lives here; an OTP provider for residents can be added later as a
 * separate endpoint that ends in the same createSession() call.
 */
auth.post(
  '/login',
  zv('json', z.object({
    identifier: z.string().trim().min(1).max(120),
    password: z.string().min(1).max(128),
    turnstileToken: z.string().max(4096).optional(),
  })),
  async (c) => {
    const { identifier, password, turnstileToken } = c.req.valid('json');
    const ip = clientIp(c);
    const db = c.get('db');

    if (!(await rateLimit(c.env, 'login-ip', ip ?? 'unknown', 30, 600))) fail(429, 'Too many login attempts from this network. Try again in 10 minutes.');
    if (!(await verifyTurnstile(c.env, turnstileToken, ip))) fail(400, 'Please complete the "I am human" check.', 'TURNSTILE');

    const ident = identifier.toLowerCase();
    const phone = identifier.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    const user = await db
      .select()
      .from(users)
      .where(or(eq(users.email, ident), eq(users.username, ident), /^\d{10}$/.test(phone) ? eq(users.phone, phone) : undefined))
      .get();

    if (!user) {
      await verifyPassword(password, DUMMY.hash, DUMMY.salt);
      await auditQuery(c, { action: 'login_failed', entity: 'user', after: { identifier: identifier.slice(0, 60), reason: 'unknown_user' }, userId: null });
      fail(401, 'Incorrect login details.');
    }

    const now = new Date();
    if (user.lockedUntil && Date.parse(user.lockedUntil) > now.getTime()) {
      await auditQuery(c, { action: 'login_failed', entity: 'user', entityId: user.id, after: { reason: 'locked' }, userId: user.id });
      const mins = Math.ceil((Date.parse(user.lockedUntil) - now.getTime()) / 60000);
      fail(423, `Account locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or ask the admin to unlock it.`, 'LOCKED');
    }

    const ok = await verifyPassword(password, user.passwordHash, user.salt);
    if (!ok || !user.isActive) {
      if (!ok) {
        const attempts = user.failedAttempts + 1;
        const lock = attempts >= MAX_FAILED_ATTEMPTS;
        await db.batch([
          db.update(users).set({
            failedAttempts: lock ? 0 : attempts,
            lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : user.lockedUntil,
          }).where(eq(users.id, user.id)),
          auditQuery(c, { action: lock ? 'account_locked' : 'login_failed', entity: 'user', entityId: user.id, after: { attempts }, userId: user.id }),
        ]);
        if (lock) fail(423, `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`, 'LOCKED');
        const left = MAX_FAILED_ATTEMPTS - attempts;
        fail(401, `Incorrect login details. ${left} attempt${left === 1 ? '' : 's'} left before the account is locked.`);
      }
      await auditQuery(c, { action: 'login_failed', entity: 'user', entityId: user.id, after: { reason: 'inactive' }, userId: user.id });
      fail(403, 'This account has been deactivated. Contact the society office.');
    }

    await db.batch([
      db.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: now.toISOString() }).where(eq(users.id, user.id)),
      auditQuery(c, { action: 'login', entity: 'user', entityId: user.id, userId: user.id }),
    ]);
    await createSession(c, user.id);
    return c.json({ user: { id: user.id, name: user.name, role: user.role, mustResetPassword: user.mustResetPassword } });
  },
);

/** Current user + flat label. Also issues the CSRF cookie for first-time visitors. */
auth.get('/me', async (c) => {
  ensureCsrfCookie(c);
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  let flat: string | null = null;
  if (user.flatId) {
    const f = await c.get('db').select({ number: flats.number, wing: wings.name }).from(flats).innerJoin(wings, eq(wings.id, flats.wingId)).where(eq(flats.id, user.flatId)).get();
    flat = f ? `${f.wing}-${f.number}` : null;
  }
  return c.json({ user: { ...user, flat } });
});

auth.post('/logout', async (c) => {
  const user = c.get('user');
  if (user) await auditQuery(c, { action: 'logout', entity: 'user', entityId: user.id });
  await destroyCurrentSession(c);
  return c.json({ ok: true });
});

auth.post('/logout-all', requireSignedIn, async (c) => {
  const user = currentUser(c);
  const db = c.get('db');
  await db.batch([
    revokeAllSessionsQuery(c, user.id),
    auditQuery(c, { action: 'logout_all', entity: 'user', entityId: user.id }),
  ]);
  await destroyCurrentSession(c);
  return c.json({ ok: true });
});

auth.post(
  '/change-password',
  requireSignedIn,
  zv('json', z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) })),
  async (c) => {
    const me = currentUser(c);
    const { currentPassword, newPassword } = c.req.valid('json');
    const db = c.get('db');
    const row = await db.select().from(users).where(eq(users.id, me.id)).get();
    if (!row) fail(404, 'User not found');
    if (!(await verifyPassword(currentPassword, row.passwordHash, row.salt))) fail(400, 'Current password is incorrect.');
    const problem = passwordProblem(row.role, newPassword);
    if (problem) fail(400, problem);
    if (newPassword === currentPassword) fail(400, 'New password must be different from the current one.');
    const { hash, salt } = await hashPassword(newPassword);
    const sessionId = c.get('sessionId')!;
    await db.batch([
      db.update(users).set({ passwordHash: hash, salt, mustResetPassword: false, updatedAt: nowIso() }).where(eq(users.id, me.id)),
      // Sign out every other device; keep this one.
      db.delete(sessions).where(and(eq(sessions.userId, me.id), ne(sessions.id, sessionId))),
      auditQuery(c, { action: 'password_change', entity: 'user', entityId: me.id }),
    ]);
    return c.json({ ok: true });
  },
);

export default auth;
