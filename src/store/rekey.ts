import { listUsers } from './accounts.ts';
import { bringUnderKey, needsKeying } from './content.ts';
import { rekeyCredentials } from './credentials.ts';
import type { Store } from './store.ts';

/**
 * Bring every person's sign-ins and mail under the store's current key, and hash again what is found by
 * hash. Reading refuses a plain value once there is a key, so a host runs this before it serves: `sift run`
 * at start, Vercel in the build. Each person's `preferences.keyed_with` says whether theirs already is,
 * so after the first time this reads one row per person until the key changes. Throws if any does not open
 * with the keys given. `write: false` only checks that every sign-in opens.
 */
export async function rekeyStore(store: Store, write: boolean): Promise<{ credentials: string[]; messages: number }> {
  const credentials: string[] = [];
  let messages = 0;
  for (const user of await listUsers(store.central)) {
    const db = await store.user(user.id);
    if (!write) await rekeyCredentials(db, false);
    else if (await needsKeying(db)) {
      const done = await bringUnderKey(db);
      credentials.push(...done.credentials);
      messages += done.messages;
    }
  }
  return { credentials, messages };
}
