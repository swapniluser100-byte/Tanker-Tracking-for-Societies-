/**
 * Creates the first super admin on a running JalSetu deployment via the one-time /api/setup
 * endpoint, authenticated with the ADMIN_BOOTSTRAP_TOKEN secret.
 *
 *   npm run admin:create -- --url https://jalsetu.example.workers.dev --name "Aditi Deshpande" \
 *     --email admin@example.com --username admin [--society "My CHS" --area Baner --city Pune --flats 120]
 *
 * The token and password are prompted for without echo, or read from
 * JALSETU_BOOTSTRAP_TOKEN / JALSETU_ADMIN_PASSWORD.
 */
import { parseArgs } from 'node:util';
import { passwordProblem } from '../src/shared/roles';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8787' },
    name: { type: 'string' },
    email: { type: 'string' },
    username: { type: 'string' },
    society: { type: 'string' },
    area: { type: 'string' },
    city: { type: 'string', default: 'Pune' },
    flats: { type: 'string' },
  },
});

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => (data += c));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''));
      return;
    }
    let input = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(input);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        input = input.slice(0, -1);
      } else {
        input += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const { url, name, email, username, society, area, city, flats } = values;
  if (!name || !email || !username) {
    console.error('Required: --name, --email and --username. See the header of scripts/create-admin.ts.');
    process.exit(1);
  }
  const base = url!.replace(/\/$/, '');
  const status = (await (await fetch(`${base}/api/setup/status`)).json()) as { needsSetup: boolean; needsSociety: boolean };
  if (!status.needsSetup) {
    console.error('This deployment already has a super admin. Use Admin → Users & roles to add more.');
    process.exit(1);
  }
  if (status.needsSociety && (!society || !area || !flats)) {
    console.error('No society exists yet: also pass --society, --area and --flats.');
    process.exit(1);
  }

  const token = process.env.JALSETU_BOOTSTRAP_TOKEN ?? (await promptHidden('Bootstrap token (ADMIN_BOOTSTRAP_TOKEN): '));
  const password = process.env.JALSETU_ADMIN_PASSWORD ?? (await promptHidden('New super admin password (10+ characters): '));
  const problem = passwordProblem('super_admin', password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  if (!process.env.JALSETU_ADMIN_PASSWORD && (await promptHidden('Confirm password: ')) !== password) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  const res = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name, email, username, password,
      society: status.needsSociety ? { name: society, area, city, flatsCount: Number(flats) } : undefined,
    }),
  });
  const body = (await res.json()) as { error?: string };
  if (!res.ok) {
    console.error(`Setup failed (${res.status}): ${body.error ?? 'unknown error'}`);
    process.exit(1);
  }
  console.log(`Super admin "${username}" created. Sign in at ${base}/login`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
