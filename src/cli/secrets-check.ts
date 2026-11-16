import { type Config, secretPaths } from '../config.ts';
import { rekeySecrets } from '../secrets.ts';
import { listUsers } from '../store/accounts.ts';
import { rekeyCredentials } from '../store/credentials.ts';
import type { Store } from '../store/store.ts';
import { paint, ui } from './ui.ts';

/**
 * Fails if a stored credential, in a file or in anyone's database, cannot be opened with the keys given.
 * `rekey` also brings every one under the current key. Returns what to tell the user once the heading is up.
 */
export async function checkSecrets(config: Config, store: Store, rekey: boolean): Promise<() => void> {
  const { encrypted, rotated } = rekeySecrets(secretPaths(config), config.keys, rekey);
  const rows: string[] = [];
  for (const user of await listUsers(store.central)) rows.push(...(await rekeyCredentials(await store.user(user.id), config.keys, rekey)));
  return () => {
    if (!config.keys.current) ui.warn(`Credentials are stored unencrypted. ${paint.cmd('sift init')} makes a key to encrypt them.`);
    if (!rekey) return;
    for (const path of encrypted) ui.ok(`Encrypted ${paint.path(path)}`);
    for (const path of rotated) ui.ok(`Re-encrypted ${paint.path(path)} with the current key`);
    for (const row of rows) ui.ok(`Brought ${row} under the current key`);
  };
}
