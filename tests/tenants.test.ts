import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Sql } from '../src/store/sql.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Controls, SignIn } from '../src/dashboard/controls.ts';
import { createDashboardServer } from '../src/dashboard/server.ts';
import { people } from '../src/store/people.ts';
import { connectAccount, connectedAddresses, listAccounts, recordSync, userOf } from '../src/store/accounts.ts';
import { type Store, openStore } from '../src/store/store.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { addRule, listRules } from '../src/store/rules.ts';

const listAccountsOf = async (db: Sql) => (await listAccounts(db)).map((a) => a.id);
import { facts } from './helpers.ts';

// Two people. Alpha set sift up and has two mailboxes; Bravo arrived later with one.
const ALPHA = 'alpha@example.org';
const ALPHA_WORK = 'alpha@work.example.com';
const BRAVO = 'bravo@example.net';
const MARK: Record<string, string> = { [ALPHA]: 'alpha-home-secret', [ALPHA_WORK]: 'alpha-work-secret', [BRAVO]: 'bravo-secret' };

let store: Store;
/** The database of whoever has `account`. */
const dbOf = async (account: string) => await store.user((await userOf(store.central, account))!.id);
let close: (() => void) | undefined;
let port: number;
let calls: string[];
const cookies: Record<string, string> = {};
const ids: Record<string, { rule: string; action: number; proposal: number }> = {};

async function seed(account: string): Promise<void> {
  const db = await dbOf(account);
  const mark = MARK[account]!;
  const sender = { address: `sender@${mark}.example.com`, domain: `${mark}.example.com` };
  await recordSync(db, account, [facts({ accountId: account, messageId: `m-${mark}`, subject: `Subject ${mark}`, from: sender })], '2', 1000);
  const decision = await recordDecision(
    db,
    account,
    `m-${mark}`,
    { disposition: 'archive', subscription: 'preserve', stage: 'agent', labelId: 'newsletter', reason: `because ${mark}` },
    { now: 1000 },
  );
  const rule = await addRule(db, account, { match: { from: sender.address }, disposition: 'archive' }, 'user', 1000);
  const action = (
    await db.run(
      `INSERT INTO actions (account_id, message_id, type, payload_json, status, created_at, decision_id) VALUES (?, ?, 'archive', '{}', 'done', 1000, ?)`,
      account,
      `m-${mark}`,
      decision,
    )
  ).lastInsertRowid;
  const proposal = (
    await db.run(
      `INSERT INTO proposals (account_id, kind, match_json, label_id, agreed, created_at) VALUES (?, 'rule', ?, 'newsletter', 5, 1000)`,
      account,
      JSON.stringify({ from: `proposed@${mark}.example.com` }),
    )
  ).lastInsertRowid;
  await db.run(
    `INSERT INTO examples (account_id, message_id, disposition, label_id, suggested, suggested_by, marked_at, status, body_text) VALUES (?, ?, 'archive', 'newsletter', 'archive', 'agent', 1000, 'captured', ?)`,
    account,
    `m-${mark}`,
    `Body ${mark}`,
  );
  ids[account] = { rule, action, proposal };
}

function call(method: 'GET' | 'POST', path: string, who: string | null, body?: unknown) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const own = method === 'POST' ? { origin: `http://localhost:${port}`, 'content-type': 'application/json', 'x-sift': '1' } : {};
    const req = request({ port, path, method, headers: { host: `localhost:${port}`, ...own, ...(who ? { cookie: cookies[who] } : {}) } }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += String(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const signIn: SignIn = {
  client: () => 'web',
  allowed: () => true,
  url: (_redirect, state) => `https://accounts.example/auth?state=${state}`,
  // The code stands in for the Google account that came back.
  complete: async (_redirect, code) => code,
};

beforeEach(async () => {
  store = await openStore(':memory:');
  calls = [];
  const alpha = await connectAccount(store, ALPHA, '1', 0);
  await connectAccount(store, ALPHA_WORK, '1', 1, alpha);
  await connectAccount(store, BRAVO, '1', 2);
  for (const account of [ALPHA, ALPHA_WORK, BRAVO]) await seed(account);

  const assets = mkdtempSync(join(tmpdir(), 'sift-web-'));
  mkdirSync(join(assets, 'assets'));
  writeFileSync(join(assets, 'index.html'), '<!doctype html>page');
  const controls: Controls = {
    settings: () => ({ act: false, interval: 60, model: null, fewShot: true, examplesKeepDays: null }),
    saveSettings: () => void calls.push('settings'),
    guidelines: () => 'guidelines alpha-owner-words',
    saveGuidelines: () => void calls.push('guidelines'),
    guidelinesChangedAt: () => null,
    models: async () => [],
    undo: async (_db, id) => (calls.push(`undo ${id}`), 'undone'),
    putBack: async () => false,
    ruleFilter: async (_db, id) => void calls.push(`filter ${id}`),
    backfill: async () => (calls.push('backfill'), 0),
    startEval: async (_db, { accountId }) => (calls.push(`eval ${accountId}`), 1),
    rejudge: async (_db, accountId) => (calls.push(`rejudge ${accountId}`), { started: 0, remaining: 0 }),
    checkNow: () => void calls.push('check'),
    activity: () => ({
      sorting: true,
      lastPassAt: 5,
      problems: [`${ALPHA}: pass failed alpha-home-secret`, `${BRAVO}: pass failed bravo-secret`],
      expired: [ALPHA_WORK, BRAVO],
    }),
  };
  const server = createDashboardServer(people(store), { assetsDir: assets, controls, signIn, sessionSecret: 'secret', now: () => 2000 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => server.close();
  port = (server.address() as AddressInfo).port;

  for (const who of [ALPHA, ALPHA_WORK, BRAVO]) {
    const login = await new Promise<string>((resolve, reject) => {
      const req = request({ port, path: '/auth/login', headers: { host: `localhost:${port}` } }, (res) => resolve(String(res.headers.location)));
      req.on('error', reject);
      req.end();
    });
    const state = new URL(login).searchParams.get('state');
    cookies[who] = await new Promise<string>((resolve, reject) => {
      const req = request({ port, path: `/auth/callback?state=${state}&code=${encodeURIComponent(who)}`, headers: { host: `localhost:${port}` } }, (res) =>
        resolve(String(res.headers['set-cookie']).split(';')[0] ?? ''),
      );
      req.on('error', reject);
      req.end();
    });
  }
});
afterEach(() => close?.());

const READS = (account: string, mark: string) => [
  '/api/summary',
  '/api/decisions',
  `/api/decisions?q=${mark}`,
  '/api/rules',
  '/api/suggestions',
  '/api/suggestions?kept=1',
  '/api/changes',
  '/api/manage',
  '/api/examples',
  '/api/evals',
  `/api/message?account=${encodeURIComponent(account)}&id=m-${mark}`,
  `/api/suggestion?account=${encodeURIComponent(account)}&sender=sender@${mark}.example.com`,
  `/api/sender?account=${encodeURIComponent(account)}&address=sender@${mark}.example.com`,
  `/api/domain?account=${encodeURIComponent(account)}&domain=${mark}.example.com`,
  `/api/examples?account=${encodeURIComponent(account)}`,
];

describe('users and their mailboxes', () => {
  it('makes the first person the owner, adds a mailbox to whoever connects it, and never moves one', async () => {
    const { central } = store;
    expect(await userOf(central, ALPHA)).toEqual({ id: 1, owner: true });
    expect(await userOf(central, ALPHA_WORK)).toEqual({ id: 1, owner: true });
    expect(await userOf(central, BRAVO)).toMatchObject({ owner: false });
    expect((await userOf(central, BRAVO))!.id).not.toBe(1);
    expect(await connectedAddresses(central, 1)).toEqual([ALPHA, ALPHA_WORK]);
    // Connecting again, even as someone else's, leaves it where it was.
    await connectAccount(store, BRAVO, '9', 5, 1);
    expect(await connectedAddresses(central, 1)).toEqual([ALPHA, ALPHA_WORK]);
    expect(await userOf(central, 'nobody@example.com')).toBeNull();
  });

  it("keeps each person's mail in a database of their own", async () => {
    const alpha = await dbOf(ALPHA);
    const bravo = await dbOf(BRAVO);
    expect(alpha).not.toBe(bravo);
    expect((await alpha.all<{ id: string }>('SELECT id FROM mailboxes ORDER BY id')).map((m) => m.id)).toEqual([ALPHA, ALPHA_WORK]);
    for (const table of ['mailboxes', 'messages', 'decisions', 'actions', 'rules', 'proposals', 'examples'])
      expect(await bravo.all(`SELECT DISTINCT ${table === 'mailboxes' ? 'id' : 'account_id'} AS id FROM ${table}`), table).toEqual([{ id: BRAVO }]);
  });

  it('gives the accounts of a database from before there were users to the first person', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sift-db-'));
    const old = new DatabaseSync(join(dir, 'sift.db'));
    old.exec(readFileSync(new URL('../src/store/migrations/legacy/001_init.sql', import.meta.url), 'utf8'));
    old.exec(`PRAGMA user_version = 1; INSERT INTO accounts (id, email, created_at) VALUES ('${ALPHA}', '${ALPHA}', 5), ('${ALPHA_WORK}', '${ALPHA_WORK}', 9)`);
    old.close();
    const migrated = await openStore({ dbPath: join(dir, 'sift.db'), usersDir: join(dir, 'users') });
    expect(await userOf(migrated.central, ALPHA)).toEqual({ id: 1, owner: true });
    expect(await listAccountsOf(await migrated.user(1))).toEqual([ALPHA, ALPHA_WORK]);
    migrated.close();
  });
});

describe("nobody sees or changes another person's mail", () => {
  it('returns nothing of the other person on any read, whatever is asked for', async () => {
    for (const [viewer, theirs] of [
      [BRAVO, [ALPHA, ALPHA_WORK]],
      [ALPHA, [BRAVO]],
      [ALPHA_WORK, [BRAVO]],
    ] as const) {
      for (const other of theirs) {
        const mark = MARK[other]!;
        for (const path of READS(other, mark)) {
          const { status, text } = await call('GET', path, viewer);
          expect([200, 404], `${viewer} GET ${path}`).toContain(status);
          expect(text, `${viewer} GET ${path} leaked ${other}`).not.toContain(mark);
          expect(text, `${viewer} GET ${path} named ${other}`).not.toContain(other);
        }
      }
    }
    // The owner's guidelines are theirs.
    expect((await call('GET', '/api/manage', BRAVO)).text).not.toContain('alpha-owner-words');
    expect((await call('GET', '/api/manage', ALPHA)).text).toContain('alpha-owner-words');
  });

  it('shows a person all of their own mailboxes, signed in as any of them, or one when asked', async () => {
    for (const viewer of [ALPHA, ALPHA_WORK]) {
      const rules = (await call('GET', '/api/rules', viewer)).text;
      expect(rules).toContain(MARK[ALPHA]);
      expect(rules).toContain(MARK[ALPHA_WORK]);
    }
    const one = await call('GET', `/api/rules?mailbox=${encodeURIComponent(ALPHA_WORK)}`, ALPHA);
    expect(one.text).toContain(MARK[ALPHA_WORK]);
    expect(one.text).not.toContain(MARK[ALPHA]);
    const summary = JSON.parse((await call('GET', `/api/summary?mailbox=${encodeURIComponent(ALPHA_WORK)}`, ALPHA)).text) as { totals: { decisions: number } };
    expect(summary.totals.decisions).toBe(1);
    // Someone else's mailbox is not one that can be asked for.
    expect((await call('GET', `/api/rules?mailbox=${encodeURIComponent(BRAVO)}`, ALPHA)).status).toBe(404);
    expect((await call('GET', '/api/rules', null)).status).toBe(401);
  });

  it("refuses every write to another person's mailbox as if it were not there, and changes nothing", async () => {
    // Ids are numbered within each person's database: these are ones Bravo's has none of.
    const theirs = ids[ALPHA_WORK]!;
    expect(theirs.action).not.toBe(ids[BRAVO]!.action);
    const db = await dbOf(ALPHA);
    const state = async () => JSON.stringify([await listRules(db, ALPHA), await db.all('SELECT * FROM labels'), await db.all('SELECT * FROM proposals')]);
    const before = await state();
    const NOBODY = 'nobody@example.com';
    // Each write, and the same write naming something nobody has: the answers must not tell them apart.
    const writes: [string, Record<string, unknown>, Record<string, unknown>][] = [
      [
        '/api/feedback',
        { accountId: ALPHA, sender: `sender@${MARK[ALPHA]}.example.com`, disposition: 'keep', scope: 'sender', messageId: `m-${MARK[ALPHA]}` },
        { accountId: NOBODY, sender: `sender@${MARK[ALPHA]}.example.com`, disposition: 'keep', scope: 'sender', messageId: `m-${MARK[ALPHA]}` },
      ],
      ['/api/labels', { accountId: ALPHA, id: 'newsletter', disposition: 'keep' }, { accountId: NOBODY, id: 'newsletter', disposition: 'keep' }],
      [
        '/api/labels/add',
        { accountId: ALPHA, name: 'Mine now', description: '', disposition: 'keep' },
        { accountId: NOBODY, name: 'Mine now', description: '', disposition: 'keep' },
      ],
      [
        '/api/rules',
        { accountId: ALPHA, match: { from: 'x@example.com' }, disposition: 'spam' },
        { accountId: NOBODY, match: { from: 'x@example.com' }, disposition: 'spam' },
      ],
      [
        '/api/standing',
        { accountId: ALPHA, address: 'x@example.com', standing: 'blocked' },
        { accountId: NOBODY, address: 'x@example.com', standing: 'blocked' },
      ],
      ['/api/rules/remove', { id: theirs.rule }, { id: 'r-nobody' }],
      ['/api/rules/filter', { id: theirs.rule, on: true }, { id: 'r-nobody', on: true }],
      ['/api/proposals', { id: theirs.proposal, accept: true }, { id: 9999, accept: true }],
      ['/api/undo', { id: theirs.action }, { id: 9999 }],
      ['/api/suggestions/rejudge', { accountId: ALPHA }, { accountId: NOBODY }],
      ['/api/examples/delete', { accountId: ALPHA, messageId: `m-${MARK[ALPHA]}` }, { accountId: NOBODY, messageId: `m-${MARK[ALPHA]}` }],
      ['/api/examples/delete-all', { accountId: ALPHA }, { accountId: NOBODY }],
      ['/api/evals/run', { accountId: ALPHA }, { accountId: NOBODY }],
    ];
    for (const [path, body, nobody] of writes) {
      const answer = await call('POST', path, BRAVO, body);
      expect(answer.status, `${path} as someone else`).toBeGreaterThanOrEqual(400);
      expect(answer.text).not.toContain(MARK[ALPHA]);
      expect(answer.status, `${path}: someone else's is told apart from nobody's`).toBe((await call('POST', path, BRAVO, nobody)).status);
    }
    expect(await state()).toBe(before);
    expect(await db.get('SELECT count(*) AS n FROM examples WHERE account_id = ?', ALPHA)).toEqual({ n: 1 });
    expect(calls).toEqual([]);

    // The same writes are the owner's to make on their own mail.
    expect((await call('POST', '/api/rules/remove', ALPHA, { id: theirs.rule })).status).toBe(200);
    expect((await call('POST', '/api/undo', ALPHA_WORK, { id: theirs.action })).status).toBe(200);
  });

  it('lets only the person who set sift up change what applies to everyone', async () => {
    for (const [path, body] of [
      ['/api/settings', { act: true }],
      ['/api/guidelines', { text: 'mine' }],
      ['/api/backfill', { days: 1 }],
    ] as const) {
      expect((await call('POST', path, BRAVO, body)).status, `${path} as a guest`).toBe(403);
      expect((await call('POST', path, ALPHA_WORK, body)).status, `${path} as the owner`).toBe(200);
    }
    expect(calls.filter((c) => c !== 'check')).toEqual(['settings', 'guidelines', 'backfill']);
    // Asking sift to look now is nobody's secret.
    expect((await call('POST', '/api/check', BRAVO, {})).status).toBe(200);
  });

  it('requires every query the dashboard runs to be given a scope', () => {
    const dir = new URL('../src/dashboard/queries/', import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((name) => [...readFileSync(new URL(name, dir), 'utf8').matchAll(/^export (?:async )?function /gm)]).length).toBeGreaterThan(5);
    const unscoped = files.flatMap((name) =>
      [...readFileSync(new URL(name, dir), 'utf8').matchAll(/^export (?:async )?function (\w+)\(([^)]*)/gm)]
        .filter((match) => !/\bscope: Scope\b/.test(match[2] ?? ''))
        .map((match) => `${name}: ${match[1]}`),
    );
    expect(unscoped, 'every exported query under src/dashboard/queries/ takes `scope: Scope`').toEqual([]);
  });
});
