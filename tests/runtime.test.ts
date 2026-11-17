import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SignIn } from '../src/dashboard/controls.ts';
import { type Ephemeral, memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { type RunOptions, askForBackfill, tick } from '../src/work/run.ts';
import { people } from '../src/store/people.ts';
import { onePerson, startDashboard } from './fixtures.ts';
import { FakeMailbox } from './helpers.ts';

/**
 * Module state that holds between calls, allowed because any instance computes the same: a cache, not a
 * record of what happened (docs/RUNTIME.md).
 */
const CACHES: Record<string, string[]> = {
  // Keys derived from SIFT_KEY.
  'src/secrets.ts': ['derived', 'hashKeys'],
};

describe('nothing is kept in module memory between calls', () => {
  it('outside the hosts, no module holds a variable or an empty collection to fill', () => {
    const unexpected: string[] = [];
    for (const file of globSync('src/**/*.ts')) {
      // The hosts: `sift run` is one long-lived process with its terminal; a Vercel instance keeps its connections.
      if (file.startsWith('src/cli/') || file.startsWith('src/vercel/')) continue;
      const held = /^(?:export )?(?:let|var) (\w+)|^(?:export )?const (\w+) = new (?:Map|Set|WeakMap|WeakSet)(?:<[^\n]*>)?\(\)/gm;
      for (const match of readFileSync(file, 'utf8').matchAll(held)) {
        const name = match[1] ?? match[2]!;
        if (!CACHES[file]?.includes(name)) unexpected.push(`${file}: ${name}`);
      }
    }
    expect(unexpected).toEqual([]);
  });
});

const ACCOUNT = 'me@example.org';

describe('a flow whose steps reach different instances', () => {
  const signIn: SignIn = {
    hasClient: () => true,
    url: (_redirect, state) => `https://accounts.example/auth?state=${state}`,
    // The code stands in for the Google account that came back.
    complete: async (_redirect, code) => code,
  };
  /** Sign in on one dashboard and come back from Google to another; true when the second signs the browser in. */
  const signInAcross = async (first: Ephemeral, second: Ephemeral) => {
    const { store } = await onePerson(ACCOUNT);
    const options = { signIn, sessionSecret: 'secret' };
    const one = await startDashboard(people(store), { ...options, ephemeral: first });
    const two = await startDashboard(people(store), { ...options, ephemeral: second });
    const login = await one.call('GET', '/auth/login');
    const state = new URL(String(login.headers['location'])).searchParams.get('state');
    const started = String(login.headers['set-cookie']).split(';')[0]!;
    const back = await two.call('GET', `/auth/callback?state=${state}&code=${encodeURIComponent(ACCOUNT)}`, undefined, { cookie: started });
    return String(back.headers['set-cookie']).includes('sift_session=ey');
  };

  it('signs in with Google when the callback reaches another instance that shares the ephemeral store', async () => {
    const shared = memoryEphemeral();
    expect(await signInAcross(shared, shared)).toBe(true);
    // What the test would catch: a sign-in kept in one instance's memory.
    expect(await signInAcross(memoryEphemeral(), memoryEphemeral())).toBe(false);
  });

  it('pulls in older mail one instance was asked for, on another', async () => {
    const { store } = await onePerson(ACCOUNT);
    const ephemeral = memoryEphemeral();
    const searched: string[] = [];
    // Each instance builds its own options; only the store and the ephemeral store are shared.
    const instance = (): RunOptions => ({
      ephemeral,
      log: () => {},
      connect: () => ({
        api: {
          getProfile: async () => ({ emailAddress: ACCOUNT, historyId: '1' }),
          listHistory: async () => ({ additions: [], historyId: '1' }),
          searchInbox: async (query) => (searched.push(query), { ids: [] }),
          getMetadata: async () => null,
          getLabelIds: async () => null,
          listLabels: async () => [],
          getContent: async () => null,
          getThread: async () => null,
          listSendAs: async () => [ACCOUNT],
        },
        mailbox: new FakeMailbox(),
      }),
    });
    await askForBackfill(instance().ephemeral, ACCOUNT, 7);
    await tick(store, instance(), Infinity);
    await tick(store, instance(), Infinity);
    expect(searched).toEqual(['newer_than:7d']);
  });
});
