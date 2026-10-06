import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { csrfCookieName } from '../lib/session';
import { timingSafeEqualStr } from '../lib/crypto';

export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Security headers for API responses (static assets get the same set from public/_headers). */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('Content-Security-Policy', CSP);
  h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
  if (new URL(c.req.url).protocol === 'https:') h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Endpoints authenticated by a bearer token instead of cookies (not CSRF-able). */
const TOKEN_AUTH_PATHS = ['/api/readings', '/api/setup'];

/**
 * CSRF protection for every state-changing request:
 *  1. Origin check — if the browser sends Origin it must be our own origin (or ALLOWED_ORIGINS).
 *  2. Double-submit token — the X-CSRF-Token header must equal the csrf cookie.
 * Combined with SameSite=Strict session cookies.
 */
export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const url = new URL(c.req.url);
  const origin = c.req.header('Origin');
  if (origin) {
    const allowed = new Set([url.origin, ...(c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
    const host = c.req.header('Host');
    if (host) allowed.add(`${url.protocol}//${host}`);
    if (!allowed.has(origin)) return c.json({ error: 'Cross-origin request blocked', code: 'CSRF' }, 403);
  }

  if (TOKEN_AUTH_PATHS.includes(url.pathname)) return next();

  const cookie = getCookie(c, csrfCookieName(c));
  const header = c.req.header('X-CSRF-Token');
  if (!cookie || !header || !timingSafeEqualStr(cookie, header)) {
    return c.json({ error: 'Security token missing or expired. Refresh the page and try again.', code: 'CSRF' }, 403);
  }
  return next();
};
