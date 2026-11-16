/**
 * Run by the deploy's build (`vercel.json`), so the database is migrated once, before any instance opens
 * it; instances starting together would otherwise migrate it at once. A first deploy, made before the
 * project has a database, builds without one.
 */
import { loadConfig } from '../config.ts';
import { openStore } from '../store/store.ts';

process.env['SIFT_HOME'] ??= '/tmp/sift';
if (process.env['DATABASE_URL']) await (await openStore(loadConfig())).close();
else process.stdout.write('No DATABASE_URL yet, so no database to migrate. Add one to the project (docs/VERCEL.md), then deploy again.\n');
