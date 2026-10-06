import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { ValidationTargets } from 'hono';

/** zValidator with a consistent 400 error body: { error, issues: [{ path, message }] }. */
export const zv = <T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      const first = issues[0];
      return c.json({ error: first ? `${first.path ? first.path + ': ' : ''}${first.message}` : 'Invalid input', issues }, 400);
    }
  });

// Reusable field schemas
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
export const zPaise = z.number().int().min(0).max(10_000_000_00);
export const zPhone = z
  .string()
  .transform((s) => s.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'));
export const zName = z.string().trim().min(1).max(120);
export const zOptionalText = (max = 2000) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
