import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { BatchItem } from 'drizzle-orm/batch';
import type { AppEnv, DB } from '../env';

export const getDb = (d1: D1Database): DB => drizzle(d1, { schema });

export function fail(status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 423 | 429 | 500 | 503, message: string, code?: string): never {
  throw new HTTPException(status, { res: Response.json({ error: message, code }, { status }) });
}

export const nowIso = () => new Date().toISOString();

export function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;
}

export function currentUser(c: Context<AppEnv>) {
  const user = c.get('user');
  if (!user) fail(401, 'Not signed in', 'UNAUTHENTICATED');
  return user;
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) fail(400, 'Invalid id');
  return id;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens Marathi text correctly. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Runs several Drizzle queries as one atomic D1 batch (all succeed or none are applied). */
export async function runBatch(db: DB, queries: BatchItem<'sqlite'>[]) {
  if (!queries.length) return [];
  return db.batch(queries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}
