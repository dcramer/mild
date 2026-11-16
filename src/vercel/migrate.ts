/**
 * Run by the deploy's build (`vercel.json`), so the database is migrated once, before any instance opens
 * it; instances starting together would otherwise migrate it at once.
 */
import { openVercelStore } from './host.ts';

const { store } = await openVercelStore();
await store.close();
