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
import type { Controls, ManagedSettings } from '../src/dashboard/controls.ts';
import { createDashboardServer } from '../src/dashboard/server.ts';
import type { RawMessage } from '../src/gmail/api.ts';
import { connectAccount, listAccounts, recordSync } from '../src/store/accounts.ts';
import { listCategories } from '../src/store/categories.ts';
import { openDb } from '../src/store/db.ts';
import { listRules } from '../src/store/rules.ts';
import { lookupSender } from '../src/store/senders.ts';
import { FakeMailbox, facts } from './helpers.ts';

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
  checkNow: () => void calls.push('check'),
  activity: () => ({ sorting: true, lastPassAt: 5, problems: [] }),
};

beforeEach(() => {
  db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
  calls = [];
  settings = { act: false, interval: 60, model: null };
  guidelines = 'Be careful.';
});
afterEach(() => close?.());

async function start(options: { accessKey?: string; withControls?: boolean } = {}) {
  const assets = mkdtempSync(join(tmpdir(), 'sift-web-'));
  mkdirSync(join(assets, 'assets'));
  writeFileSync(join(assets, 'index.html'), '<!doctype html>page');
  const server = createDashboardServer(db, {
    assetsDir: assets,
    ...(options.withControls === false ? {} : { controls }),
    ...(options.accessKey ? { accessKey: options.accessKey } : {}),
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
    expect((body['categories'] as Record<string, { key: string }[]>)[ACCOUNT]?.map((c) => c.key)).toContain('newsletter');
    expect((await call(port, 'GET', '/api/models')).body).toEqual({ models: ['p/small', 'p/large'] });
  });

  it('changes settings, and refuses values that make no sense', async () => {
    const port = await start();
    expect((await call(port, 'POST', '/api/settings', { act: true, model: 'p/small' })).body).toEqual({
      settings: { act: true, interval: 60, model: 'p/small' },
    });
    expect((await call(port, 'POST', '/api/settings', { model: null, interval: 300 })).body).toEqual({ settings: { act: true, interval: 300, model: null } });
    for (const bad of [{ act: 'yes' }, { interval: 1 }, { interval: '60' }, { model: 'no-slash' }])
      expect((await call(port, 'POST', '/api/settings', bad)).status).toBe(400);
    expect(settings).toEqual({ act: true, interval: 300, model: null });
  });

  it('edits the guidelines, categories, rules and senders', async () => {
    const port = await start();
    expect((await call(port, 'POST', '/api/guidelines', { text: 'Recruiters are cold outreach.' })).status).toBe(200);
    expect(guidelines).toBe('Recruiters are cold outreach.');
    expect((await call(port, 'POST', '/api/guidelines', { text: 'x'.repeat(9000) })).status).toBe(400);

    expect((await call(port, 'POST', '/api/categories', { accountId: ACCOUNT, key: 'newsletter', disposition: 'keep' })).status).toBe(200);
    expect(listCategories(db, ACCOUNT).find((c) => c.key === 'newsletter')?.disposition).toBe('keep');
    expect((await call(port, 'POST', '/api/categories', { accountId: ACCOUNT, key: 'nonsense', disposition: 'keep' })).status).toBe(409);
    expect((await call(port, 'POST', '/api/categories', { accountId: ACCOUNT, key: 'newsletter', disposition: 'delete' })).status).toBe(400);

    const added = await call(port, 'POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { fromDomain: 'example.com', subjectContains: '' },
      disposition: 'archive',
    });
    expect(listRules(db, ACCOUNT)).toMatchObject([{ id: added.body['id'], match: { fromDomain: 'example.com' }, disposition: 'archive', source: 'user' }]);
    expect((await call(port, 'POST', '/api/rules', { accountId: ACCOUNT, match: {}, disposition: 'archive' })).status).toBe(400);
    expect((await call(port, 'POST', '/api/rules', { accountId: ACCOUNT, match: { body: 'x' }, disposition: 'archive' })).status).toBe(400);
    expect((await call(port, 'POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(200);
    expect((await call(port, 'POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(409);

    expect((await call(port, 'POST', '/api/senders', { accountId: ACCOUNT, address: 'News@Example.com', disposition: 'archive' })).status).toBe(200);
    expect(lookupSender(db, ACCOUNT, 'news@example.com')).toMatchObject({ disposition: 'archive' });
    expect(((await call(port, 'GET', '/api/senders')).body['senders'] as unknown[]).length).toBe(1);
    expect((await call(port, 'POST', '/api/senders', { accountId: ACCOUNT, address: 'news@example.com', forget: true })).status).toBe(200);
    expect(lookupSender(db, ACCOUNT, 'news@example.com')).toBeNull();
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
      '/api/categories',
      '/api/rules',
      '/api/rules/remove',
      '/api/senders',
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

describe('access key', () => {
  const KEY = 'correct-horse-battery';

  it('turns away everything without the key, and lets the link in once', async () => {
    const port = await start({ accessKey: KEY });
    for (const path of ['/', '/api/summary', '/api/manage', '/assets/x.js']) expect((await call(port, 'GET', path)).status).toBe(401);
    expect((await call(port, 'POST', '/api/settings', { act: true })).status).toBe(401);
    expect((await call(port, 'GET', '/?key=wrong')).status).toBe(401);
    expect((await call(port, 'GET', '/api/summary', undefined, { cookie: 'sift_key=wrong' })).status).toBe(401);

    const link = await call(port, 'GET', `/?key=${KEY}`);
    expect(link.status).toBe(303);
    expect(link.headers['location']).toBe('/');
    expect(String(link.headers['set-cookie'])).toMatch(/^sift_key=correct-horse-battery; .*HttpOnly; SameSite=Strict$/);

    const cookie = { cookie: `other=1; sift_key=${KEY}` };
    expect((await call(port, 'GET', '/', undefined, cookie)).body).toEqual({ text: '<!doctype html>page' });
    expect((await call(port, 'POST', '/api/settings', { act: true }, cookie)).status).toBe(200);
  });

  it('is not asked for when none is set', async () => {
    expect((await call(await start(), 'GET', '/api/summary')).status).toBe(200);
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
