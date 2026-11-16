import type { Credential, CredentialStore } from '@earendil-works/pi-ai';

/**
 * Where one person's model sign-ins are kept, as text by provider id. sift keeps them encrypted in that
 * person's database; this module never sees where.
 */
export interface SignIns {
  read(provider: string): Promise<string | null>;
  write(provider: string, text: string): Promise<void>;
  remove(provider: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * pi-ai's credential store over `SignIns`. An OAuth refresh token rotates each time it is used, so the
 * new one has to be stored, and writes are serialised within this process: run one sift process per
 * home, or two would race to refresh the same token.
 */
export function credentialStore(signIns: SignIns): CredentialStore {
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };
  const read = async (provider: string) => {
    const text = await signIns.read(provider);
    return text === null ? undefined : (JSON.parse(text) as Credential);
  };
  return {
    read,
    list: async () =>
      (await Promise.all((await signIns.keys()).map(async (providerId) => ({ providerId, credential: await read(providerId) })))).flatMap(
        ({ providerId, credential }) => (credential ? [{ providerId, type: credential.type }] : []),
      ),
    modify: (provider, fn) =>
      exclusive(async () => {
        const next = await fn(await read(provider));
        if (next === undefined) await signIns.remove(provider);
        else await signIns.write(provider, JSON.stringify(next));
        return next;
      }),
    delete: (provider) => exclusive(() => signIns.remove(provider)),
  };
}
