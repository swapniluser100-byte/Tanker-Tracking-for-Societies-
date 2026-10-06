import type { Env } from '../env';

/**
 * Fixed-window rate limiter on Workers KV. KV is eventually consistent, so this is a
 * soft limit (good enough to stop runaway sensors and password spraying from one IP);
 * the hard per-account lockout lives in D1 (users.failed_attempts / locked_until).
 * Returns true when the request is allowed.
 */
export async function rateLimit(env: Env, bucket: string, id: string, limit: number, windowSec: number): Promise<boolean> {
  if (!env.RATE_LIMIT) return true;
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${id}:${window}`;
  const current = Number((await env.RATE_LIMIT.get(key)) ?? '0');
  if (current >= limit) return false;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  return true;
}
