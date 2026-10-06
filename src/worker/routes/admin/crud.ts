import type { Hono, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import { eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { AppEnv } from '../../env';
import { auditQuery } from '../../lib/audit';
import { fail, parseId } from '../../lib/http';
import { zv } from '../../lib/validate';

type TableWithId = SQLiteTable & { id: SQLiteColumn };

interface CrudOptions<C extends z.ZodType, U extends z.ZodType> {
  path: string;
  table: TableWithId;
  entity: string;
  create: C;
  update: U;
  orderBy?: SQLiteColumn | SQL;
  /** Extra guards (e.g. super-admin only) applied to write routes. */
  writeGuard?: MiddlewareHandler<AppEnv>;
  /** Map validated input to column values (e.g. rupees → paise). */
  toRow?: (input: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Registers GET list, POST create, PUT update and DELETE routes for a simple admin table.
 * Every write is committed together with its audit_logs row in one D1 batch.
 */
export function registerCrud<C extends z.ZodType, U extends z.ZodType>(app: Hono<AppEnv>, o: CrudOptions<C, U>) {
  const guard: MiddlewareHandler<AppEnv> = o.writeGuard ?? (async (_c, next) => next());
  const toRow = o.toRow ?? ((x) => x);
  // Drizzle's generic table types don't compose well here; the zod schemas are the real contract.
  const table = o.table as any;

  app.get(o.path, async (c) => {
    const q = c.get('db').select().from(table);
    const rows = await (o.orderBy ? q.orderBy(o.orderBy) : q);
    return c.json({ items: rows });
  });

  app.post(o.path, guard, zv('json', o.create), async (c) => {
    const db = c.get('db');
    const values = toRow(c.req.valid('json' as never) as Record<string, unknown>);
    let row: any;
    try {
      row = ((await db.insert(table).values(values).returning()) as any[])[0];
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, 'An item with these details already exists.');
      throw e;
    }
    await auditQuery(c, { action: 'create', entity: o.entity, entityId: row.id, after: row });
    return c.json({ item: row }, 201);
  });

  app.put(`${o.path}/:id`, guard, zv('json', o.update), async (c) => {
    const db = c.get('db');
    const id = parseId(c.req.param('id'));
    const before = await db.select().from(table).where(eq(o.table.id, id)).get();
    if (!before) fail(404, 'Not found');
    const values = toRow(c.req.valid('json' as never) as Record<string, unknown>);
    if ('updatedAt' in (before as object)) values.updatedAt = new Date().toISOString();
    try {
      await db.batch([
        db.update(table).set(values).where(eq(o.table.id, id)),
        auditQuery(c, { action: 'update', entity: o.entity, entityId: id, before, after: values }),
      ]);
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, 'An item with these details already exists.');
      throw e;
    }
    return c.json({ item: { ...(before as object), ...values } });
  });

  app.delete(`${o.path}/:id`, guard, async (c) => {
    const db = c.get('db');
    const id = parseId(c.req.param('id'));
    const before = await db.select().from(table).where(eq(o.table.id, id)).get();
    if (!before) fail(404, 'Not found');
    try {
      await db.batch([db.delete(table).where(eq(o.table.id, id)), auditQuery(c, { action: 'delete', entity: o.entity, entityId: id, before })]);
    } catch (e) {
      if (String(e).includes('FOREIGN KEY')) fail(409, 'This is used by existing records. Deactivate it instead of deleting.');
      throw e;
    }
    return c.json({ ok: true });
  });
}
