// Wrangler bundles *.sql imports as text (default module rule); Vitest does the same via vitest.config.ts.
declare module '*.sql' {
  const sql: string;
  export default sql;
}
