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
  /**
   * Run `work` while nothing else changes this person's sign-ins, in this process or any other: an OAuth
   * refresh token works once, and two refreshing it at once would leave the person signed out.
   */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
}

/** pi-ai's credential store over `SignIns`. Every change, a token refresh included, is made under `exclusive`. */
export function credentialStore(signIns: SignIns): CredentialStore {
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
      signIns.exclusive(async () => {
        const next = await fn(await read(provider));
        if (next === undefined) await signIns.remove(provider);
        else await signIns.write(provider, JSON.stringify(next));
        return next;
      }),
    delete: (provider) => signIns.exclusive(() => signIns.remove(provider)),
  };
}
