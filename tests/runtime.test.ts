import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Ephemeral, memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { type RunOptions, tick } from '../src/work/run.ts';
import { startInboxRuns } from '../src/store/inbox.ts';
import { people } from '../src/store/people.ts';
import { googleSignIn, onePerson, startDashboard } from './fixtures.ts';
import { ACCOUNT, FakeMailbox, codeSignIn, testModel } from './helpers.ts';

/**
 * Module state that holds between calls, allowed because any instance computes the same: a cache, not a
 * record of what happened (docs/runtime.md).
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

describe('a flow whose steps reach different instances', () => {
  /** Sign in on one dashboard and come back from Google to another; true when the second signs the browser in. */
  const signInAcross = async (first: Ephemeral, second: Ephemeral) => {
    const { store } = await onePerson(ACCOUNT);
    const options = { signIn: codeSignIn, sessionSecret: 'secret' };
    const one = await startDashboard(people(store), { ...options, ephemeral: first });
    const two = await startDashboard(people(store), { ...options, ephemeral: second });
    const back = await googleSignIn(one, ACCOUNT, two);
    return String(back.headers['set-cookie']).includes('sift_session=ey');
  };

  it('signs in with Google when the callback reaches another instance that shares the ephemeral store', async () => {
    const shared = memoryEphemeral();
    expect(await signInAcross(shared, shared)).toBe(true);
    // What the test would catch: a sign-in kept in one instance's memory.
    expect(await signInAcross(memoryEphemeral(), memoryEphemeral())).toBe(false);
  });

  it('goes through an inbox one instance was asked to, on another', async () => {
    const { store, db } = await onePerson(ACCOUNT);
    const ephemeral = memoryEphemeral();
    const searched: string[] = [];
    // Each instance builds its own options; only the store and the ephemeral store are shared.
    const instance = (): RunOptions => ({
      ephemeral,
      log: () => {},
      model: async () => testModel(),
      connect: () => ({
        api: {
          getProfile: async () => ({ emailAddress: ACCOUNT, historyId: '1' }),
          listHistory: async () => ({ additions: [], historyId: '1' }),
          searchInbox: async (query) => (searched.push(query), { ids: [] }),
          inboxSize: async () => 0,
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
    await startInboxRuns(db, [ACCOUNT], { acts: false, most: 10, now: 0 });
    await tick(store, instance(), Infinity);
    await tick(store, instance(), Infinity);
    expect(searched).toEqual(['']);
  });
});
