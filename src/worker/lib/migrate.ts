// Applies pending D1 migrations from inside the Worker, so a fresh deployment (e.g. Cloudflare
// Workers Builds, where only `wrangler deploy` runs) gets its schema without a manual
// `wrangler d1 migrations apply`. Applied migrations are recorded in the same `d1_migrations`
// table wrangler uses, so running `wrangler d1 migrations apply` later stays consistent.
import init0000 from '../../../migrations/0000_init.sql';

// Add new migration files here (in order) when `npm run db:generate` creates them.
const MIGRATIONS: { name: string; sql: string }[] = [{ name: '0000_init.sql', sql: init0000 }];

let schemaReady: Promise<void> | null = null;

async function applyPending(d1: D1Database) {
  await d1.prepare(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
  ).run();
  const applied = new Set((await d1.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    const statements = m.sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
    try {
      // One batch = one transaction: the whole migration and its record commit together.
      await d1.batch([...statements.map((s) => d1.prepare(s)), d1.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(m.name)]);
      console.log(`Applied D1 migration ${m.name}`);
    } catch (e) {
      // Another isolate may have applied it at the same moment; only rethrow if it is still missing.
      const done = await d1.prepare('SELECT 1 FROM d1_migrations WHERE name = ?').bind(m.name).first();
      if (!done) throw e;
    }
  }
}

/** Runs at most once per isolate; retries on the next request if it failed. */
export function ensureSchema(d1: D1Database | undefined): Promise<void> {
  if (!d1) return Promise.resolve();
  schemaReady ??= applyPending(d1).catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}
