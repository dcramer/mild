import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';

type Stored = Record<string, Credential>;

/**
 * Model provider credentials in one owner-only JSON file. pi-ai ships only an in-memory store, and an
 * OAuth refresh token rotates each time it is used, so the new one has to reach disk.
 *
 * Writes are serialised within this process and replace the file atomically. Run one sift process per
 * data directory against a subscription login: two would race to refresh the same token.
 */
export function fileCredentialStore(path: string): CredentialStore {
  let queue: Promise<unknown> = Promise.resolve();

  const load = (): Stored => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Stored) : {});
  const save = (stored: Stored) => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  };
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
