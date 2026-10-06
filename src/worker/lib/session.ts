import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { and, eq, gt } from 'drizzle-orm';
import { sessions, users } from '../db/schema';
import type { AppEnv, SessionUser } from '../env';
import { generateToken, sha256Hex } from './crypto';
import { clientIp } from './http';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
/** Sliding renewal: extend the session when less than this much time remains (i.e. at most one write per hour). */
const RENEW_WHEN_REMAINING_MS = 11 * 60 * 60 * 1000;

/**
 * Cookie names. Over HTTPS we use the __Host- prefix (forces Secure, Path=/, no Domain).
 * Plain-HTTP local development (wrangler dev on localhost) uses unprefixed, non-Secure names.
 */
function isHttps(c: Context<AppEnv>) {
  return new URL(c.req.url).protocol === 'https:';
}
export const sessionCookieName = (c: Context<AppEnv>) => (isHttps(c) ? '__Host-jalsetu_sid' : 'jalsetu_sid');
export const csrfCookieName = (c: Context<AppEnv>) => (isHttps(c) ? '__Host-jalsetu_csrf' : 'jalsetu_csrf');

function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, sessionCookieName(c), token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Double-submit CSRF token: readable by our JS, echoed back in the X-CSRF-Token header. */
export function ensureCsrfCookie(c: Context<AppEnv>): string {
  const existing = getCookie(c, csrfCookieName(c));
  if (existing && existing.length >= 32) return existing;
  const token = generateToken(32);
  setCookie(c, csrfCookieName(c), token, { httpOnly: false, secure: isHttps(c), sameSite: 'Strict', path: '/' });
  return token;
}

export async function createSession(c: Context<AppEnv>, userId: number) {
  const token = generateToken(32);
  const now = Date.now();
  await c.get('db').insert(sessions).values({
    tokenHash: await sha256Hex(token),
    userId,
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    ip: clientIp(c),
    userAgent: c.req.header('User-Agent')?.slice(0, 300) ?? null,
  });
  setSessionCookie(c, token);
  // Rotate the CSRF token on login.
  deleteCookie(c, csrfCookieName(c), { path: '/', secure: isHttps(c) });
  setCookie(c, csrfCookieName(c), generateToken(32), { httpOnly: false, secure: isHttps(c), sameSite: 'Strict', path: '/' });
}

/** Loads the session (if any) into c.var.user. Never throws for a missing/expired session. */
export async function loadSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, sessionCookieName(c));
  if (!token || token.length > 100) return;
  const db = c.get('db');
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now.toISOString())))
    .get();
  if (!row || !row.user.isActive) return;

  const remaining = Date.parse(row.session.expiresAt) - now.getTime();
  if (remaining < RENEW_WHEN_REMAINING_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(), lastSeenAt: now.toISOString() })
      .where(eq(sessions.id, row.session.id));
    setSessionCookie(c, token);
  }

  const u = row.user;
  const user: SessionUser = {
    id: u.id, name: u.name, email: u.email, username: u.username, phone: u.phone,
    role: u.role, flatId: u.flatId, mustResetPassword: u.mustResetPassword,
  };
  c.set('user', user);
  c.set('sessionId', row.session.id);
}

export async function destroyCurrentSession(c: Context<AppEnv>) {
  const id = c.get('sessionId');
  if (id) await c.get('db').delete(sessions).where(eq(sessions.id, id));
  deleteCookie(c, sessionCookieName(c), { path: '/', secure: isHttps(c) });
}

export function revokeAllSessionsQuery(c: Context<AppEnv>, userId: number) {
  return c.get('db').delete(sessions).where(eq(sessions.userId, userId));
}
