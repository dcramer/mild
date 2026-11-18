import { expect, it, vi } from 'vitest';
import { buildSignIn } from '../src/sift/google-sign-in.ts';
import { loadConfig } from '../src/config.ts';
import { userOf } from '../src/store/accounts.ts';
import { freshStore } from './fixtures.ts';
import { tempDir } from './helpers.ts';

// The code stands in for the Google account that came back.
vi.mock('../src/gmail/auth.ts', () => ({
  hasClientSecrets: () => true,
  loadClientSecrets: () => ({}),
  browserSignInUrl: () => '',
  completeBrowserSignIn: async (_secrets: unknown, { code }: { code: string }) => ({ email: code, historyId: '1', refreshToken: `token-${code}` }),
}));

it('lets in every account Google does: arriving alone, a person of its own; added, another mailbox of whoever added it', async () => {
  const store = await freshStore();
  const signIn = buildSignIn(loadConfig({ SIFT_HOME: tempDir() }), store);
  await signIn.complete('', 'me@example.org', '', null);
  await signIn.complete('', 'work@example.com', '', 'me@example.org');
  await signIn.complete('', 'friend@example.net', '', null);
  // An account never changes hands, whoever is signed in when it comes back.
  await signIn.complete('', 'work@example.com', '', 'friend@example.net');

  expect(await userOf(store.central, 'me@example.org')).toEqual({ id: 1, owner: true });
  expect(await userOf(store.central, 'work@example.com')).toEqual({ id: 1, owner: true });
  expect(await userOf(store.central, 'friend@example.net')).toEqual({ id: 2, owner: false });
});
