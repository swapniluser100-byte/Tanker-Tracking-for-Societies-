import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Match wrangler's default rule: `import sql from './x.sql'` gives the file's text.
  plugins: [{ name: 'sql-as-text', load: (id) => (id.endsWith('.sql') ? `export default ${JSON.stringify(readFileSync(id, 'utf8'))};` : null) }],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
