import { type Config, secretPaths } from '../config.ts';
import { rekeySecrets } from '../secrets.ts';
import { listUsers } from '../store/accounts.ts';
import { rekeyBodies } from '../store/bodies.ts';
import { rekeyCredentials } from '../store/credentials.ts';
import type { Store } from '../store/store.ts';
import { paint, ui } from './ui.ts';

/**
 * Fails if a stored credential or message body, in a file or in anyone's database, cannot be opened with
 * the keys given. `rekey` also brings every one under the current key. Returns what to tell the user once the heading is up.
 */
export async function checkSecrets(config: Config, store: Store, rekey: boolean): Promise<() => void> {
  const { encrypted, rotated } = rekeySecrets(secretPaths(config), config.keys, rekey);
  const rows: string[] = [];
  let bodies = 0;
  for (const user of await listUsers(store.central)) {
    const db = await store.user(user.id);
    rows.push(...(await rekeyCredentials(db, rekey)));
    bodies += await rekeyBodies(db, rekey);
  }
  return () => {
    if (!config.keys.current) ui.warn(`Credentials and message bodies are stored unencrypted. ${paint.cmd('sift init')} makes a key to encrypt them.`);
    if (!rekey) return;
    for (const path of encrypted) ui.ok(`Encrypted ${paint.path(path)}`);
    for (const path of rotated) ui.ok(`Re-encrypted ${paint.path(path)} with the current key`);
    for (const row of rows) ui.ok(`Brought ${row} under the current key`);
    if (bodies > 0) ui.ok(`Brought ${bodies === 1 ? 'one message' : `${bodies} messages`} under the current key`);
  };
}
