import { type Config, secretPaths } from '../config.ts';
import { rekeySecrets } from '../secrets.ts';
import { paint, ui } from './ui.ts';

/**
 * Fails if a stored credential cannot be opened with the keys given. `rekey` also brings every one under
 * the current key. Returns what to tell the user once the heading is up.
 */
export function checkSecrets(config: Config, rekey: boolean): () => void {
  const { encrypted, rotated } = rekeySecrets(secretPaths(config), config.keys, rekey);
  return () => {
    if (!config.keys.current) ui.warn(`Credentials are stored unencrypted. ${paint.cmd('sift init')} makes a key to encrypt them.`);
    if (!rekey) return;
    for (const path of encrypted) ui.ok(`Encrypted ${paint.path(path)}`);
    for (const path of rotated) ui.ok(`Re-encrypted ${paint.path(path)} with the current key`);
  };
}
