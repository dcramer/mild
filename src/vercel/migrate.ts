/**
 * Run by the deploy's build (`vercel.json`), so the database is migrated and brought under `MILD_KEY`
 * once, before any instance opens it; instances starting together would otherwise do it at once. A first
 * deploy, made before the project has a database, builds without one.
 */
import { loadConfig } from '../config.ts';
import { named } from '../env.ts';
import { rekeyStore } from '../store/rekey.ts';
import { openStore } from '../store/store.ts';

if (!named(process.env, 'MILD_HOME')) process.env['MILD_HOME'] = '/tmp/mild';
if (process.env['DATABASE_URL']) {
  const store = await openStore(loadConfig());
  try {
    const { credentials, messages } = await rekeyStore(store, true);
    for (const row of credentials) process.stdout.write(`Brought ${row} under the current key\n`);
    if (messages > 0) process.stdout.write(`Brought ${messages === 1 ? 'one message' : `${messages} messages`} under the current key\n`);
  } finally {
    await store.close();
  }
} else process.stdout.write('No DATABASE_URL yet, so no database to migrate. Add one to the project (docs/vercel.md), then deploy again.\n');
