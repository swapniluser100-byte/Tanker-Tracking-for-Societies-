import type { Context } from 'hono';
import { auditLogs } from '../db/schema';
import type { AppEnv } from '../env';
import { clientIp } from './http';

const SECRET_FIELDS = new Set(['passwordHash', 'password_hash', 'salt', 'keyHash', 'key_hash', 'tokenHash', 'token_hash', 'password']);

function scrub(obj: unknown): string | null {
  if (obj === undefined || obj === null) return null;
  return JSON.stringify(obj, (k, v) => (SECRET_FIELDS.has(k) ? '[redacted]' : v));
}

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  userId?: number | null;
}

/**
 * Returns an insert query for audit_logs so it can be included in a D1 batch()
 * together with the change it records (both commit or neither does).
 */
export function auditQuery(c: Context<AppEnv>, e: AuditEntry) {
  return c.get('db').insert(auditLogs).values({
    userId: e.userId === undefined ? (c.get('user')?.id ?? null) : e.userId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId == null ? null : String(e.entityId),
    beforeJson: scrub(e.before),
    afterJson: scrub(e.after),
    ip: clientIp(c),
  });
}

export async function audit(c: Context<AppEnv>, e: AuditEntry) {
  await auditQuery(c, e);
}
