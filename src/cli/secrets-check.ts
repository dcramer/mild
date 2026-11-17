import { type Config, secretPaths } from '../config.ts';
import { rekeySecrets } from '../secrets.ts';
import { rekeyStore } from '../store/rekey.ts';
import type { Store } from '../store/store.ts';
import { paint, ui } from './ui.ts';

/**
 * Fails if a stored credential or message, in a file or in anyone's database, cannot be opened with
 * the keys given. `rekey` also brings every one under the current key. Returns what to tell the user once the heading is up.
 */
export async function checkSecrets(config: Config, store: Store, rekey: boolean): Promise<() => void> {
  const { encrypted, rotated } = rekeySecrets(secretPaths(config), config.keys, rekey);
  const { credentials: rows, messages } = await rekeyStore(store, rekey);
  return () => {
    if (!config.keys.current) ui.warn(`Credentials and mail are stored unencrypted. ${paint.cmd('sift init')} makes a key to encrypt them.`);
    if (!rekey) return;
    for (const path of encrypted) ui.ok(`Encrypted ${paint.path(path)}`);
    for (const path of rotated) ui.ok(`Re-encrypted ${paint.path(path)} with the current key`);
    for (const row of rows) ui.ok(`Brought ${row} under the current key`);
    if (messages > 0) ui.ok(`Brought ${messages === 1 ? 'one message' : `${messages} messages`} under the current key`);
  };
}
