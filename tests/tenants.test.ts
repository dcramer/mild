import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Controls, SignIn } from '../src/dashboard/controls.ts';
import { createDashboardServer } from '../src/dashboard/server.ts';
import { accountsOf, connectAccount, recordSync, userOf } from '../src/store/accounts.ts';
import { openDb } from '../src/store/db.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { addRule, listRules } from '../src/store/rules.ts';
import { facts } from './helpers.ts';

// Two people. Alpha set sift up and has two mailboxes; Bravo arrived later with one.
const ALPHA = 'alpha@example.org';
const ALPHA_WORK = 'alpha@work.example.com';
const BRAVO = 'bravo@example.net';
const MARK: Record<string, string> = { [ALPHA]: 'alpha-home-secret', [ALPHA_WORK]: 'alpha-work-secret', [BRAVO]: 'bravo-secret' };

let db: DatabaseSync;
let close: (() => void) | undefined;
let port: number;
let calls: string[];
const cookies: Record<string, string> = {};
const ids: Record<string, { rule: string; action: number; proposal: number }> = {};

function seed(account: string): void {
  const mark = MARK[account]!;
  const sender = { address: `sender@${mark}.example.com`, domain: `${mark}.example.com` };
  recordSync(db, account, [facts({ accountId: account, messageId: `m-${mark}`, subject: `Subject ${mark}`, from: sender })], '2', 1000);
  const decision = recordDecision(
    db,
    account,
    `m-${mark}`,
    { disposition: 'archive', subscription: 'preserve', stage: 'agent', labelId: 'newsletter', reason: `because ${mark}` },
    { now: 1000 },
  );
  const rule = addRule(db, account, { match: { from: sender.address }, disposition: 'archive' }, 'user', 1000);
  const action = Number(
    db
      .prepare(
        `INSERT INTO actions (account_id, message_id, type, payload_json, status, created_at, decision_id) VALUES (?, ?, 'archive', '{}', 'done', 1000, ?)`,
      )
      .run(account, `m-${mark}`, decision).lastInsertRowid,
  );
  const proposal = Number(
    db
      .prepare(`INSERT INTO proposals (account_id, kind, match_json, label_id, agreed, created_at) VALUES (?, 'rule', ?, 'newsletter', 5, 1000)`)
      .run(account, JSON.stringify({ from: `proposed@${mark}.example.com` })).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO examples (account_id, message_id, disposition, label_id, suggested, suggested_by, marked_at, status, body_text) VALUES (?, ?, 'archive', 'newsletter', 'archive', 'agent', 1000, 'captured', ?)`,
  ).run(account, `m-${mark}`, `Body ${mark}`);
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
  db = openDb(':memory:');
  calls = [];
  connectAccount(db, ALPHA, '1', 0);
  connectAccount(db, ALPHA_WORK, '1', 1, userOf(db, ALPHA)!.id);
  connectAccount(db, BRAVO, '1', 2);
  for (const account of [ALPHA, ALPHA_WORK, BRAVO]) seed(account);

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
    undo: async (id) => (calls.push(`undo ${id}`), 'undone'),
    putBack: async () => false,
    ruleFilter: async (id) => void calls.push(`filter ${id}`),
    backfill: async () => (calls.push('backfill'), 0),
    startEval: async ({ accountId }) => (calls.push(`eval ${accountId}`), 1),
    rejudge: async (accountId) => (calls.push(`rejudge ${accountId}`), { started: 0, remaining: 0 }),
    checkNow: () => void calls.push('check'),
    activity: () => ({
      sorting: true,
      lastPassAt: 5,
      problems: [`${ALPHA}: pass failed alpha-home-secret`, `${BRAVO}: pass failed bravo-secret`],
      expired: [ALPHA_WORK, BRAVO],
    }),
  };
  const server = createDashboardServer(db, { assetsDir: assets, controls, signIn, sessionSecret: 'secret', now: () => 2000 });
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
  it('makes the first person the owner, adds a mailbox to whoever connects it, and never moves one', () => {
    expect(userOf(db, ALPHA)).toEqual({ id: 1, owner: true });
    expect(userOf(db, ALPHA_WORK)).toEqual({ id: 1, owner: true });
    expect(userOf(db, BRAVO)).toMatchObject({ owner: false });
    expect(userOf(db, BRAVO)!.id).not.toBe(1);
    expect(accountsOf(db, 1).map((a) => a.email)).toEqual([ALPHA, ALPHA_WORK]);
    // Connecting again, even as someone else's, leaves it where it was.
    connectAccount(db, BRAVO, '9', 5, 1);
    expect(accountsOf(db, 1).map((a) => a.email)).toEqual([ALPHA, ALPHA_WORK]);
    expect(userOf(db, 'nobody@example.com')).toBeNull();
  });

  it('gives the accounts of a database from before there were users to the first person', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sift-db-')), 'sift.db');
    const migrations = new URL('../src/store/migrations/', import.meta.url);
    const old = new DatabaseSync(path);
    old.exec(readFileSync(new URL('001_init.sql', migrations), 'utf8'));
    old.exec(`PRAGMA user_version = 1; INSERT INTO accounts (id, email, created_at) VALUES ('${ALPHA}', '${ALPHA}', 5), ('${ALPHA_WORK}', '${ALPHA_WORK}', 9)`);
    old.close();
    const migrated = openDb(path);
    expect(userOf(migrated, ALPHA)).toEqual({ id: 1, owner: true });
    expect(accountsOf(migrated, 1)).toHaveLength(2);
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
    const theirs = ids[ALPHA]!;
    const before = JSON.stringify([listRules(db, ALPHA), db.prepare('SELECT * FROM labels').all(), db.prepare('SELECT * FROM proposals').all()]);
    const writes: [string, unknown][] = [
      ['/api/feedback', { accountId: ALPHA, sender: `sender@${MARK[ALPHA]}.example.com`, disposition: 'keep', scope: 'sender', messageId: `m-${MARK[ALPHA]}` }],
      ['/api/labels', { accountId: ALPHA, id: 'newsletter', disposition: 'keep' }],
      ['/api/labels/add', { accountId: ALPHA, name: 'Mine now', description: '', disposition: 'keep' }],
      ['/api/rules', { accountId: ALPHA, match: { from: 'x@example.com' }, disposition: 'spam' }],
      ['/api/standing', { accountId: ALPHA, address: 'x@example.com', standing: 'blocked' }],
      ['/api/rules/remove', { id: theirs.rule }],
      ['/api/rules/filter', { id: theirs.rule, on: true }],
      ['/api/proposals', { id: theirs.proposal, accept: true }],
      ['/api/undo', { id: theirs.action }],
      ['/api/suggestions/rejudge', { accountId: ALPHA }],
      ['/api/examples/delete', { accountId: ALPHA, messageId: `m-${MARK[ALPHA]}` }],
      ['/api/examples/delete-all', { accountId: ALPHA }],
      ['/api/evals/run', { accountId: ALPHA }],
    ];
    for (const [path, body] of writes) {
      const { status, text } = await call('POST', path, BRAVO, body);
      expect(status, `${path} as someone else`).toBe(404);
      expect(text).not.toContain(MARK[ALPHA]);
    }
    expect(JSON.stringify([listRules(db, ALPHA), db.prepare('SELECT * FROM labels').all(), db.prepare('SELECT * FROM proposals').all()])).toBe(before);
    expect(db.prepare('SELECT count(*) AS n FROM examples WHERE account_id = ?').get(ALPHA)).toEqual({ n: 1 });
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
    const source = readFileSync(new URL('../src/dashboard/queries.ts', import.meta.url), 'utf8');
    const unscoped = [...source.matchAll(/^export function (\w+)\(([^)]*)/gm)]
      .filter((match) => !/\bscope: Scope\b/.test(match[2] ?? ''))
      .map((match) => match[1]);
    expect(unscoped, 'every exported query in src/dashboard/queries.ts takes `scope: Scope`').toEqual([]);
  });
});
