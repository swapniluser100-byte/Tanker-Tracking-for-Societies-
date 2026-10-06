import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, SessionUser } from '../src/worker/env';
import type { Role } from '../src/shared/roles';

// Replace the D1-backed session loader with one that reads a test header, so these tests
// exercise the real routers and middleware chain without a database.
vi.mock('../src/worker/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/worker/lib/session')>();
  return {
    ...actual,
    loadSession: async (c: { req: { header: (n: string) => string | undefined }; set: (k: string, v: unknown) => void }) => {
      const role = c.req.header('x-test-role') as Role | undefined;
      if (!role) return;
      const user: SessionUser = {
        id: 99, name: 'Test', email: null, username: null, phone: null, role, flatId: null,
        mustResetPassword: c.req.header('x-test-must-reset') === '1',
      };
      c.set('user', user);
      c.set('sessionId', 1);
    },
  };
});

const { requireRole } = await import('../src/worker/middleware/auth');
const { default: app } = await import('../src/worker/index');

const env = { APP_ENV: 'development', TURNSTILE_SITE_KEY: 'x', ALLOWED_ORIGINS: '' } as unknown as AppEnv['Bindings'];
const CSRF = 'a'.repeat(43);

function call(path: string, opts: { method?: string; role?: Role; csrf?: boolean; mustReset?: boolean; origin?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.role) headers['x-test-role'] = opts.role;
  if (opts.mustReset) headers['x-test-must-reset'] = '1';
  if (opts.csrf) {
    headers.Cookie = `jalsetu_csrf=${CSRF}`;
    headers['X-CSRF-Token'] = CSRF;
  }
  if (opts.origin) headers.Origin = opts.origin;
  return app.request(`http://localhost${path}`, { method: opts.method ?? 'GET', headers, body: opts.method && opts.method !== 'GET' ? '{}' : undefined }, env);
}

describe('requireRole middleware (unit)', () => {
  const mini = new Hono<AppEnv>();
  mini.use('*', async (c, next) => {
    const role = c.req.header('x-role') as Role | undefined;
    c.set('user', role ? ({ id: 1, role, mustResetPassword: false } as SessionUser) : undefined);
    await next();
  });
  mini.get('/treasury', requireRole('super_admin', 'treasurer'), (c) => c.text('ok'));
  mini.get('/any', requireRole(), (c) => c.text('ok'));

  it('401 when not signed in', async () => {
    expect((await mini.request('/treasury')).status).toBe(401);
  });
  it('403 for a role not in the list', async () => {
    expect((await mini.request('/treasury', { headers: { 'x-role': 'guard' } })).status).toBe(403);
  });
  it('passes for an allowed role', async () => {
    const res = await mini.request('/treasury', { headers: { 'x-role': 'treasurer' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
  it('requireRole() with no roles allows any signed-in user', async () => {
    expect((await mini.request('/any', { headers: { 'x-role': 'resident' } })).status).toBe(200);
    expect((await mini.request('/any')).status).toBe(401);
  });
});

describe('role checks on the real API routes', () => {
  it.each([
    '/api/dashboard', '/api/bookings', '/api/admin/overview', '/api/admin/users', '/api/guard/today', '/api/resident/home', '/api/expenses',
  ])('%s → 401 without a session', async (path) => {
    expect((await call(path)).status).toBe(401);
  });

  it.each<[string, Role]>([
    ['/api/admin/overview', 'guard'],
    ['/api/admin/overview', 'resident'],
    ['/api/admin/overview', 'treasurer'],
    ['/api/admin/users', 'committee_admin'],
    ['/api/admin/api-keys', 'committee_admin'],
    ['/api/admin/data/backup.json', 'committee_admin'],
    ['/api/dashboard', 'guard'],
    ['/api/dashboard', 'resident'],
    ['/api/guard/today', 'resident'],
    ['/api/guard/today', 'treasurer'],
    ['/api/expenses', 'resident'],
  ])('GET %s → 403 for %s', async (path, role) => {
    expect((await call(path, { role })).status).toBe(403);
  });

  it.each<[string, Role]>([
    ['/api/bookings', 'treasurer'], // treasurer approves but does not book
    ['/api/bookings/1/approve', 'committee_admin'], // committee books but cannot self-approve
    ['/api/expenses', 'committee_admin'],
    ['/api/guard/checkins', 'resident'],
    ['/api/admin/vendors', 'treasurer'],
  ])('POST %s → 403 for %s', async (path, role) => {
    expect((await call(path, { method: 'POST', role, csrf: true })).status).toBe(403);
  });

  it('blocks everything except account endpoints until a forced password reset is done', async () => {
    const res = await call('/api/dashboard', { role: 'committee_admin', mustReset: true });
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'PASSWORD_RESET_REQUIRED' });
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing request without the double-submit token', async () => {
    const res = await call('/api/bookings', { method: 'POST', role: 'committee_admin' });
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'CSRF' });
  });
  it('rejects a cross-origin request even with a token', async () => {
    const res = await call('/api/auth/logout', { method: 'POST', role: 'committee_admin', csrf: true, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
  it('sets security headers on API responses', async () => {
    const res = await call('/api/health');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});
