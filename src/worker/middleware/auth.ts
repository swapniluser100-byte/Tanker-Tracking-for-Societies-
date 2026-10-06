import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import type { Role } from '../../shared/roles';
import { loadSession } from '../lib/session';

/** Attaches c.var.user when a valid session cookie is present. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', undefined);
  await loadSession(c);
  await next();
};

/**
 * Requires a signed-in user with one of the given roles. Enforced on the API for every
 * protected route — the UI hiding a link is never the access control.
 * Users flagged must_reset_password can only reach the account endpoints until they change it.
 */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Not signed in', code: 'UNAUTHENTICATED' }, 401);
    if (user.mustResetPassword) return c.json({ error: 'You must change your password first', code: 'PASSWORD_RESET_REQUIRED' }, 403);
    if (roles.length > 0 && !roles.includes(user.role)) return c.json({ error: 'You do not have access to this', code: 'FORBIDDEN' }, 403);
    await next();
  };
}

/** Any signed-in user, including those who must reset their password (for /me, change-password, logout). */
export const requireSignedIn: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'Not signed in', code: 'UNAUTHENTICATED' }, 401);
  await next();
};
