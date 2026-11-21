import { listUsers } from './accounts.ts';
import { rekeyContent } from './content.ts';
import { rekeyCredentials } from './credentials.ts';
import type { Store } from './store.ts';

/**
 * Bring every person's sign-ins and mail under the store's current key, and hash again what is found by
 * hash. Reading refuses a plain value once there is a key, so a host runs this before it serves: `mild run`
 * at start, Vercel in the build. Throws if any does not open with the keys given; `write: false` only checks.
 */
export async function rekeyStore(store: Store, write: boolean): Promise<{ credentials: string[]; messages: number }> {
  const credentials: string[] = [];
  let messages = 0;
  for (const user of await listUsers(store.central)) {
    const db = await store.user(user.id);
    credentials.push(...(await rekeyCredentials(db, write)));
    messages += await rekeyContent(db, write);
  }
  return { credentials, messages };
}
