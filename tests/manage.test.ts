import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_BACKFILL, backfill } from '../src/daemon/backfill.ts';
import { type RunOptions, createWake, runLoop } from '../src/daemon/run.ts';
import { triageAccount } from '../src/daemon/triage.ts';
import type { Controls, ManagedSettings, SignIn } from '../src/dashboard/controls.ts';
import { createDashboardServer } from '../src/dashboard/server.ts';
import type { RawMessage } from '../src/gmail/api.ts';
import { startEval } from '../src/learn/evals.ts';
import { connectAccount, listAccounts, recordSync } from '../src/store/accounts.ts';
import { listLabels } from '../src/store/labels.ts';
import { openDb } from '../src/store/db.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { listRules } from '../src/store/rules.ts';
import { FakeMailbox, facts, storeExample } from './helpers.ts';

const ACCOUNT = 'me@example.org';
let db: DatabaseSync;
let close: (() => void) | undefined;
let calls: string[];
let settings: ManagedSettings;
let guidelines: string;

const controls: Controls = {
  settings: () => settings,
  saveSettings: (change) => {
    settings = { ...settings, ...change };
  },
  models: async () => ['p/small', 'p/large'],
  guidelines: () => guidelines,
  saveGuidelines: (text) => {
    guidelines = text;
  },
  undo: async (id) => {
    calls.push(`undo ${id}`);
    if (id === 404) throw new Error('There is no change #404.');
    return 'Reversed.';
  },
  backfill: async (days) => {
    calls.push(`backfill ${days}`);
    return 12;
  },
  putBack: async (_account, messageId) => {
    calls.push(`putBack ${messageId}`);
    if (messageId === 'gone') throw new Error('The message no longer exists.');
    return true;
  },
  startEval: async ({ accountId, fewShot, limit }) => {
    calls.push(`eval ${accountId} ${fewShot} ${limit}`);
    return 7;
  },
  checkNow: () => void calls.push('check'),
  activity: () => ({ sorting: true, lastPassAt: 5, problems: [] }),
};

beforeEach(() => {
  db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
  calls = [];
  settings = { act: false, interval: 60, model: null, fewShot: true };
  guidelines = 'Be careful.';
});
afterEach(() => close?.());

async function start(options: { withControls?: boolean } = {}) {
  const assets = mkdtempSync(join(tmpdir(), 'sift-web-'));
  mkdirSync(join(assets, 'assets'));
  writeFileSync(join(assets, 'index.html'), '<!doctype html>page');
  const server = createDashboardServer(db, {
    assetsDir: assets,
    ...(options.withControls === false ? {} : { controls }),
    now: () => 77,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => server.close();
  return (server.address() as AddressInfo).port;
}

function call(port: number, method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const own = method === 'POST' ? { origin: `http://localhost:${port}`, 'content-type': 'application/json', 'x-sift': '1' } : {};
    const req = request({ port, path, method, headers: { host: `localhost:${port}`, ...own, ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += String(chunk)));
      res.on('end', () => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          parsed = { text: data };
        }
        resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('managing sift from the dashboard', () => {
  it('shows how sift is set up', async () => {
    const port = await start();
    const { body } = await call(port, 'GET', '/api/manage');
    expect(body).toMatchObject({
      settings: { act: false, interval: 60, model: null },
      guidelines: 'Be careful.',
      activity: { sorting: true },
      accounts: [{ id: ACCOUNT }],
    });
    expect((body['labels'] as Record<string, { id: string; gmailLabel: string; rules: number }[]>)[ACCOUNT]).toContainEqual(
      expect.objectContaining({ id: 'newsletter', gmailLabel: 'sift/newsletters', rules: 0, messages: 0, record: { reviewed: 0, right: 0 } }),
    );
    expect((await call(port, 'GET', '/api/models')).body).toEqual({ models: ['p/small', 'p/large'] });
  });

  it('changes settings, and refuses values that make no sense', async () => {
    const port = await start();
    expect((await call(port, 'POST', '/api/settings', { act: true, model: 'p/small' })).body).toEqual({
      settings: { act: true, interval: 60, model: 'p/small', fewShot: true },
    });
    expect((await call(port, 'POST', '/api/settings', { model: null, interval: 300 })).body).toEqual({
      settings: { act: true, interval: 300, model: null, fewShot: true },
    });
    expect((await call(port, 'POST', '/api/settings', { fewShot: false })).body).toMatchObject({ settings: { fewShot: false } });
    for (const bad of [{ act: 'yes' }, { interval: 1 }, { interval: '60' }, { model: 'no-slash' }, { fewShot: 'no' }])
      expect((await call(port, 'POST', '/api/settings', bad)).status).toBe(400);
    expect(settings).toEqual({ act: true, interval: 300, model: null, fewShot: false });
  });

  it('starts a test run of the model only when asked, through the process that holds the model', async () => {
    const port = await start();
    storeExample(db, ACCOUNT, { id: 'e1', from: 'news@example.com', label: 'newsletter' });
    expect((await call(port, 'GET', '/api/evals')).body).toEqual({ runs: [], examples: { [ACCOUNT]: 1 }, defaultLimit: 50, maxLimit: 200 });
    expect(calls).toEqual([]);

    expect((await call(port, 'POST', '/api/evals/run', { accountId: ACCOUNT })).body).toEqual({ id: 7 });
    expect((await call(port, 'POST', '/api/evals/run', { accountId: ACCOUNT, fewShot: false, limit: 20 })).status).toBe(200);
    expect(calls).toEqual([`eval ${ACCOUNT} true 50`, `eval ${ACCOUNT} false 20`]);
    for (const bad of [
      {},
      { accountId: 'nobody@example.org' },
      { accountId: ACCOUNT, limit: 201 },
      { accountId: ACCOUNT, limit: 0 },
      { accountId: ACCOUNT, fewShot: 1 },
    ])
      expect((await call(port, 'POST', '/api/evals/run', bad)).status).toBe(400);

    const { id, done } = startEval(
      { db, judge: async () => ({ label: 'marketing', reason: 'r' }), model: 'p/small', guidelines: '' },
      { accountId: ACCOUNT, fewShot: false },
    );
    await done;
    const listed = (await call(port, 'GET', '/api/evals')).body['runs'] as { id: number; model: string; score: { wrong: number } }[];
    expect(listed).toMatchObject([{ id, model: 'p/small', status: 'done', fewShot: false, score: { total: 1, wrong: 1 } }]);
    const detail = await call(port, 'GET', `/api/eval?id=${id}`);
    expect(detail.body).toMatchObject({ run: { id }, results: [{ messageId: 'e1', expected: 'newsletter', got: 'marketing', subject: 'Subject e1' }] });
    expect((await call(port, 'GET', '/api/eval?id=99')).status).toBe(404);

    close?.();
    const bare = await start({ withControls: false });
    expect((await call(bare, 'POST', '/api/evals/run', { accountId: ACCOUNT })).status).toBe(409);
  });

  it('edits the guidelines, labels and rules', async () => {
    const port = await start();
    expect((await call(port, 'POST', '/api/guidelines', { text: 'Recruiters are cold outreach.' })).status).toBe(200);
    expect(guidelines).toBe('Recruiters are cold outreach.');
    expect((await call(port, 'POST', '/api/guidelines', { text: 'x'.repeat(9000) })).status).toBe(400);

    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'newsletter', disposition: 'keep', name: 'Reading' })).status).toBe(200);
    expect(listLabels(db, ACCOUNT).find((l) => l.id === 'newsletter')).toMatchObject({ disposition: 'keep', name: 'Reading', gmailLabel: 'sift/newsletters' });
    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'nonsense', disposition: 'keep' })).status).toBe(409);
    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'newsletter', disposition: 'delete' })).status).toBe(400);

    const mine = await call(port, 'POST', '/api/labels/add', {
      accountId: ACCOUNT,
      name: 'Investor updates',
      description: 'Updates from companies I invested in.',
      disposition: 'keep',
    });
    expect(mine.body).toEqual({ id: 'investor-updates' });
    expect(listLabels(db, ACCOUNT).at(-1)).toEqual({
      id: 'investor-updates',
      name: 'Investor updates',
      description: 'Updates from companies I invested in.',
      disposition: 'keep',
      gmailLabel: 'sift/investor-updates',
    });
    for (const taken of ['investor updates', 'Review', 'Did', 'Cold outreach', '!!!'])
      expect((await call(port, 'POST', '/api/labels/add', { accountId: ACCOUNT, name: taken, description: '', disposition: 'keep' })).status).toBe(409);
    expect((await call(port, 'POST', '/api/labels/add', { accountId: 'nobody@example.org', name: 'X', description: '', disposition: 'keep' })).status).toBe(
      400,
    );

    const added = await call(port, 'POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { fromDomain: 'example.com', subjectContains: '' },
      label: 'investor-updates',
    });
    const excepted = await call(port, 'POST', '/api/rules', { accountId: ACCOUNT, match: { from: 'a@example.com' }, label: 'marketing', disposition: 'keep' });
    expect(listRules(db, ACCOUNT)).toMatchObject([
      { id: added.body['id'], match: { fromDomain: 'example.com' }, labelId: 'investor-updates', source: 'user' },
      { id: excepted.body['id'], labelId: 'marketing', disposition: 'keep' },
    ]);
    expect(listRules(db, ACCOUNT)[0]).not.toHaveProperty('disposition');
    expect((await call(port, 'GET', '/api/rules')).body['rules']).toMatchObject([
      { labelName: 'Investor updates', override: null, disposition: 'keep' },
      { labelName: 'Marketing', override: 'keep', disposition: 'keep' },
    ]);
    expect((await call(port, 'POST', '/api/rules', { accountId: ACCOUNT, match: {}, label: 'marketing' })).status).toBe(400);
    expect((await call(port, 'POST', '/api/rules', { accountId: ACCOUNT, match: { body: 'x' }, label: 'marketing' })).status).toBe(400);
    expect((await call(port, 'POST', '/api/rules', { accountId: ACCOUNT, match: { from: 'a@example.com' }, label: 'no-such-label' })).status).toBe(409);
    expect(
      (await call(port, 'POST', '/api/rules', { accountId: ACCOUNT, match: { from: 'a@example.com' }, label: 'marketing', disposition: 'review' })).status,
    ).toBe(400);
    expect((await call(port, 'POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(200);
    expect((await call(port, 'POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(409);
  });

  it('sets what a label does, including blocking and marking read', async () => {
    const port = await start();
    const does = () => listLabels(db, ACCOUNT).find((l) => l.id === 'marketing');
    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', disposition: 'block' })).status).toBe(200);
    expect(does()).toMatchObject({ disposition: 'spam', block: true });
    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', disposition: 'archive', markRead: true })).status).toBe(200);
    expect(does()).toMatchObject({ disposition: 'archive', markRead: true });
    expect(does()).not.toHaveProperty('block');
    const shown = ((await call(port, 'GET', '/api/manage')).body['labels'] as Record<string, { id: string; disposition: string; markRead: boolean }[]>)[
      ACCOUNT
    ];
    expect(shown?.find((l) => l.id === 'marketing')).toMatchObject({ disposition: 'archive', markRead: true });
    expect(shown?.find((l) => l.id === 'phishing')).toMatchObject({ disposition: 'block', markRead: false });
    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'personal', unsubscribe: true })).status).toBe(200);
    expect(listLabels(db, ACCOUNT).find((l) => l.id === 'personal')).toMatchObject({ disposition: 'keep', unsubscribe: true });
    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'personal', unsubscribe: 'yes' })).status).toBe(400);
    const extra = await call(port, 'POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { from: 'x@example.com' },
      label: 'security',
      unsubscribe: true,
      markRead: true,
    });
    expect(listRules(db, ACCOUNT).find((r) => r.id === extra.body['id'])).toMatchObject({ subscription: 'unsubscribe', markRead: true });
    // "Leave it for me" is no longer something a label can be set to do.
    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', disposition: 'review' })).status).toBe(400);
    expect((await call(port, 'POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', markRead: 'yes' })).status).toBe(400);
    expect((await call(port, 'POST', '/api/labels/add', { accountId: ACCOUNT, name: 'Scams', description: '', disposition: 'block' })).body).toEqual({
      id: 'scams',
    });
    expect(listLabels(db, ACCOUNT).at(-1)).toMatchObject({ id: 'scams', disposition: 'spam', block: true });
  });

  it('puts a corrected message right in Gmail, and still saves the answer if it cannot', async () => {
    recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'done' }), facts({ accountId: ACCOUNT, messageId: 'gone' })], '2');
    for (const id of ['done', 'gone'])
      recordDecision(db, ACCOUNT, id, { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r', labelId: 'marketing' }, { mode: 'act' });
    const port = await start();
    const answer = { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'once' };
    expect((await call(port, 'POST', '/api/feedback', { ...answer, messageId: 'done' })).body).toMatchObject({
      corrected: 'done',
      fixed: 'What sift did to this message in Gmail has been taken back.',
    });
    const failed = await call(port, 'POST', '/api/feedback', { ...answer, messageId: 'gone' });
    expect(failed.status).toBe(200);
    expect(failed.body['fixed']).toContain('could not be put back in Gmail: The message no longer exists.');
    expect(db.prepare('SELECT count(*) AS n FROM feedback').get()).toEqual({ n: 2 });
    expect(calls).toEqual(['putBack done', 'putBack gone']);
  });

  it('asks the running sift to undo, pull in older mail and check now', async () => {
    const port = await start();
    expect((await call(port, 'POST', '/api/undo', { id: 3 })).body).toEqual({ message: 'Reversed.' });
    expect(await call(port, 'POST', '/api/undo', { id: 404 })).toMatchObject({ status: 409, body: { error: 'There is no change #404.' } });
    expect((await call(port, 'POST', '/api/backfill', { days: 7 })).body).toEqual({ added: 12 });
    expect((await call(port, 'POST', '/api/backfill', { days: 400 })).status).toBe(400);
    expect((await call(port, 'POST', '/api/check', {})).status).toBe(200);
    expect(calls).toEqual(['undo 3', 'undo 404', 'backfill 7', 'check', 'check']);
  });

  it('refuses every write that did not come from its own page', async () => {
    const port = await start();
    for (const path of [
      '/api/settings',
      '/api/guidelines',
      '/api/labels',
      '/api/labels/add',
      '/api/rules',
      '/api/rules/remove',
      '/api/undo',
      '/api/backfill',
      '/api/check',
      '/api/feedback',
    ]) {
      expect((await call(port, 'POST', path, { act: true }, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await call(port, 'POST', path, { act: true }, { 'x-sift': '' })).status).toBe(403);
    }
    expect((await call(port, 'POST', '/api/nope', {})).status).toBe(405);
    expect(settings.act).toBe(false);
    expect(calls).toEqual([]);
  });

  it('can only look, not manage, when no controls are given', async () => {
    const port = await start({ withControls: false });
    expect((await call(port, 'POST', '/api/settings', { act: true })).status).toBe(409);
    expect((await call(port, 'POST', '/api/undo', { id: 1 })).status).toBe(409);
    expect((await call(port, 'GET', '/api/manage')).body).toMatchObject({ activity: { sorting: false } });
  });
});

describe('signing in with Google', () => {
  const SECRET = 'session-secret';
  let completed: string[];
  let kind: 'web' | 'desktop' | null;
  const signIn: SignIn = {
    client: () => kind,
    url: (redirectUri, state, challenge) => `https://accounts.example/auth?redirect=${encodeURIComponent(redirectUri)}&state=${state}&challenge=${challenge}`,
    complete: async (redirectUri, code, _verifier, allowNew) => {
      completed.push(`${redirectUri} ${code} new=${allowNew}`);
      if (code === 'stranger') throw new Error('stranger@example.net is not the account sift is connected to.');
      if (code === 'second') {
        connectAccount(db, 'work@example.com', '1', 0);
        return 'work@example.com';
      }
      return ACCOUNT;
    },
  };

  async function startWithSignIn() {
    const assets = mkdtempSync(join(tmpdir(), 'sift-web-'));
    mkdirSync(join(assets, 'assets'));
    writeFileSync(join(assets, 'index.html'), '<!doctype html>page');
    writeFileSync(join(assets, 'assets', 'app.js'), '1');
    const server = createDashboardServer(db, {
      assetsDir: assets,
      controls,
      signIn,
      sessionSecret: SECRET,
      signInAddresses: ['http://localhost:1', 'https://box.example.ts.net'],
      allowedHosts: ['box.example.ts.net', 'homebox'],
      now: () => 1000,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => server.close();
    return (server.address() as AddressInfo).port;
  }
  const cookieFrom = (headers: Record<string, string | string[] | undefined>) => String(headers['set-cookie']).split(';')[0] ?? '';
  const stateFrom = (headers: Record<string, string | string[] | undefined>) => new URL(String(headers['location'])).searchParams.get('state') ?? '';

  beforeEach(() => {
    completed = [];
    kind = 'web';
  });

  it('serves the page to anyone but the data only to someone signed in', async () => {
    const port = await startWithSignIn();
    expect((await call(port, 'GET', '/')).status).toBe(200);
    expect((await call(port, 'GET', '/assets/app.js')).status).toBe(200);
    for (const path of ['/api/summary', '/api/manage', '/api/suggestions', '/api/senders']) expect((await call(port, 'GET', path)).status).toBe(401);
    expect((await call(port, 'POST', '/api/settings', { act: true })).status).toBe(401);
    expect((await call(port, 'GET', '/api/summary', undefined, { cookie: 'sift_session=forged.signature' })).status).toBe(401);
    expect((await call(port, 'GET', '/api/session')).body).toMatchObject({ required: true, email: null, canSignIn: true, reason: null });
    expect(settings.act).toBe(false);
  });

  it('signs in through Google and returns to the address the browser used', async () => {
    const port = await startWithSignIn();
    const login = await call(port, 'GET', '/auth/login');
    expect(login.status).toBe(303);
    expect(String(login.headers['location'])).toContain(encodeURIComponent(`http://localhost:${port}/auth/callback`));

    const back = await call(port, 'GET', `/auth/callback?state=${stateFrom(login.headers)}&code=abc`);
    expect(back.status).toBe(303);
    expect(back.headers['location']).toBe('/');
    expect(String(back.headers['set-cookie'])).toMatch(/^sift_session=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    expect(completed).toEqual([`http://localhost:${port}/auth/callback abc new=false`]);

    const cookie = { cookie: cookieFrom(back.headers) };
    expect((await call(port, 'GET', '/api/session', undefined, cookie)).body).toMatchObject({ email: ACCOUNT });
    expect((await call(port, 'GET', '/api/manage', undefined, cookie)).status).toBe(200);
    expect((await call(port, 'POST', '/api/settings', { act: true }, cookie)).status).toBe(200);

    // The same state cannot be used twice, and an unknown one is refused.
    expect(String((await call(port, 'GET', `/auth/callback?state=${stateFrom(login.headers)}&code=abc`)).headers['location'])).toContain('expired');
    expect(completed).toHaveLength(1);
  });

  it('uses HTTPS for the return address and the cookie behind Tailscale serve', async () => {
    const port = await startWithSignIn();
    const proxied = { host: 'box.example.ts.net', 'x-forwarded-proto': 'https' };
    const login = await call(port, 'GET', '/auth/login', undefined, proxied);
    expect(String(login.headers['location'])).toContain(encodeURIComponent('https://box.example.ts.net/auth/callback'));
    const back = await call(port, 'GET', `/auth/callback?state=${stateFrom(login.headers)}&code=abc`, undefined, proxied);
    expect(String(back.headers['set-cookie'])).toMatch(/; Secure$/);
  });

  it('explains why sign-in is not possible at a plain address, without a client, or with a Desktop client', async () => {
    const port = await startWithSignIn();
    const plain = await call(port, 'GET', '/api/session', undefined, { host: `homebox:${port}` });
    expect(plain.body).toMatchObject({ canSignIn: false, reason: 'address', addresses: ['http://localhost:1', 'https://box.example.ts.net'] });
    expect((await call(port, 'GET', '/auth/login', undefined, { host: `homebox:${port}` })).headers['location']).toBe('/');

    kind = 'desktop';
    expect((await call(port, 'GET', '/api/session', undefined, { host: 'box.example.ts.net', 'x-forwarded-proto': 'https' })).body).toMatchObject({
      canSignIn: false,
      reason: 'desktop-client',
    });
    expect((await call(port, 'GET', '/api/session')).body).toMatchObject({ canSignIn: false, reason: 'desktop-client' });

    kind = null;
    expect((await call(port, 'GET', '/api/session')).body).toMatchObject({ canSignIn: false, reason: 'no-client' });
  });

  it('turns away an account sift is not connected to, and adds a second one only for someone signed in', async () => {
    const port = await startWithSignIn();
    const login = await call(port, 'GET', '/auth/login?add=1');
    const refused = await call(port, 'GET', `/auth/callback?state=${stateFrom(login.headers)}&code=stranger`);
    expect(decodeURIComponent(String(refused.headers['location']))).toBe('/?signin=stranger@example.net is not the account sift is connected to.');
    expect(refused.headers['set-cookie']).toBeUndefined();
    expect(completed.at(-1)).toContain('new=false');

    const first = await call(port, 'GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await call(port, 'GET', `/auth/callback?state=${stateFrom(first.headers)}&code=abc`)).headers) };
    const add = await call(port, 'GET', '/auth/login?add=1', undefined, cookie);
    const added = await call(port, 'GET', `/auth/callback?state=${stateFrom(add.headers)}&code=second`, undefined, cookie);
    expect(completed.at(-1)).toContain('new=true');
    expect((await call(port, 'GET', '/api/session', undefined, { cookie: cookieFrom(added.headers) })).body).toMatchObject({ email: 'work@example.com' });
  });

  it('ends a session on sign-out, when it expires, and when its account is removed', async () => {
    const port = await startWithSignIn();
    const login = await call(port, 'GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await call(port, 'GET', `/auth/callback?state=${stateFrom(login.headers)}&code=abc`)).headers) };
    const out = await call(port, 'POST', '/api/signout', {}, cookie);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');

    db.exec('DELETE FROM accounts');
    expect((await call(port, 'GET', '/api/summary', undefined, cookie)).status).toBe(401);
  });

  it('does not believe a forwarded scheme from another machine', async () => {
    // Every test request comes from this machine, so this checks the header alone is not enough to be
    // offered sign-in at a name that is not localhost.
    const port = await startWithSignIn();
    expect((await call(port, 'GET', '/api/session', undefined, { host: `homebox:${port}`, 'x-forwarded-proto': 'http' })).body).toMatchObject({
      canSignIn: false,
    });
  });
});

describe('older mail', () => {
  const raw = (id: string): RawMessage => ({
    id,
    threadId: `t${id}`,
    labelIds: ['INBOX'],
    internalDate: 5,
    headers: [
      { name: 'From', value: 'news@example.com' },
      { name: 'Subject', value: id },
    ],
  });

  it('is pulled in without moving the sync cursor, and only once', async () => {
    const api = {
      searchInbox: async (query: string) => (calls.push(query), { ids: ['a', 'b', 'gone'] }),
      getMetadata: async (id: string) => (id === 'gone' ? null : raw(id)),
    };
    expect(await backfill(db, api, ACCOUNT, 7)).toBe(2);
    expect(await backfill(db, api, ACCOUNT, 7)).toBe(0);
    expect(calls).toEqual(['newer_than:7d', 'newer_than:7d']);
    expect(listAccounts(db)[0]?.historyId).toBe('1');
    expect(db.prepare('SELECT id, observe_only FROM messages ORDER BY id').all()).toEqual([
      { id: 'a', observe_only: 1 },
      { id: 'b', observe_only: 1 },
    ]);
  });

  it('stops at the cap', async () => {
    let page = 0;
    const api = {
      searchInbox: async () => ({ ids: Array.from({ length: 200 }, (_, i) => `p${page}-${i}`), nextPageToken: `t${++page}` }),
      getMetadata: async (id: string) => raw(id),
    };
    expect(await backfill(db, api, ACCOUNT, 30)).toBe(MAX_BACKFILL);
    expect(page).toBe(2);
  });

  it('is only ever suggested about, even while sift acts on new mail', async () => {
    await backfill(db, { searchInbox: async () => ({ ids: ['old'] }), getMetadata: async (id) => raw(id) }, ACCOUNT, 7);
    recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'new' })], '2');
    const mailbox = new FakeMailbox();
    mailbox.labels.set('old', ['INBOX']);
    mailbox.labels.set('new', ['INBOX']);
    await triageAccount({ db, mailbox }, listAccounts(db)[0]!);
    expect(db.prepare('SELECT message_id, mode, outcome FROM decisions ORDER BY message_id').all()).toEqual([
      { message_id: 'new', mode: 'act', outcome: 'done' },
      { message_id: 'old', mode: 'observe', outcome: 'observed' },
    ]);
    expect(mailbox.labels.get('old')).toEqual(['INBOX']);
  });
});

describe('run loop', () => {
  it('asks for its settings before every pass and can be woken early', async () => {
    db.exec('DELETE FROM accounts');
    const stop = new AbortController();
    const wake = createWake();
    const seen: number[] = [];
    let pass = 0;
    const next = async (): Promise<RunOptions & { intervalMs: number }> => {
      seen.push(++pass);
      return {
        act: pass > 1,
        connect: () => {
          throw new Error('no accounts');
        },
        log: () => {},
        intervalMs: 60_000,
      };
    };
    const started = Date.now();
    const done = runLoop(db, next, {
      signal: stop.signal,
      wake,
      onPass: () => {
        // Wake during the wait that follows; stop after the third pass.
        if (pass < 3) setTimeout(() => wake.now(), 5);
        else setTimeout(() => stop.abort(), 5);
      },
    });
    await done;
    expect(seen).toEqual([1, 2, 3]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
