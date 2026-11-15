import type { Credential, CredentialStore } from '@earendil-works/pi-ai';
import { type Keyring, readSecret, writeSecret } from '../secrets.ts';

type Stored = Record<string, Credential>;

/**
 * Model provider credentials in one owner-only JSON file, encrypted when `keys` has a key. pi-ai ships only an in-memory store, and an
 * OAuth refresh token rotates each time it is used, so the new one has to reach disk.
 *
 * Writes are serialised within this process and replace the file atomically. Run one sift process per
 * data directory against a subscription login: two would race to refresh the same token.
 */
export function fileCredentialStore(path: string, keys: Keyring = { current: null, old: [] }): CredentialStore {
  let queue: Promise<unknown> = Promise.resolve();

  const load = (): Stored => JSON.parse(readSecret(path, keys) ?? '{}') as Stored;
  const save = (stored: Stored) => writeSecret(path, JSON.stringify(stored, null, 2), keys);
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    read: async (providerId) => load()[providerId],
    list: async () => Object.entries(load()).map(([providerId, credential]) => ({ providerId, type: credential.type })),
    modify: (providerId, fn) =>
      exclusive(async () => {
        const stored = load();
        const next = await fn(stored[providerId]);
        if (next === undefined) delete stored[providerId];
        else stored[providerId] = next;
        save(stored);
        return next;
      }),
    delete: (providerId) =>
      exclusive(async () => {
        const stored = load();
        delete stored[providerId];
        save(stored);
      }),
  };
}
