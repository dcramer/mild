import { readFileSync, readdirSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Controls, SignIn } from '../src/dashboard/controls.ts';
import { people } from '../src/store/people.ts';
import { connectAccount, connectedAddresses, listUsers, mailboxesOf, personOf, recordSync, userOf } from '../src/store/accounts.ts';
import { finishLabelProposal, listLabels, startLabelProposal } from '../src/store/labels.ts';
import { preferences, setModel } from '../src/store/preferences.ts';
import type { Store } from '../src/store/store.ts';
import { freshStore, raw, rowsBy, startDashboard } from './fixtures.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { addRule, listRules } from '../src/store/rules.ts';
import { facts, withSampleLabels } from './helpers.ts';
import { conditionsHash } from '../src/store/content.ts';
import { startEval } from '../src/learn/evals.ts';
import * as api from '../src/dashboard/api/index.ts';

// Two people. Alpha set sift up and has two mailboxes; Bravo arrived later with one.
const ALPHA = 'alpha@example.org';
const ALPHA_WORK = 'alpha@work.example.com';
const BRAVO = 'bravo@example.net';
const MARK: Record<string, string> = { [ALPHA]: 'alpha-home-secret', [ALPHA_WORK]: 'alpha-work-secret', [BRAVO]: 'bravo-secret' };

let store: Store;
/** The database of whoever has `account`. */
const dbOf = async (account: string) => await store.user((await userOf(store.central, account))!.id);
let dashboard: Awaited<ReturnType<typeof startDashboard>>;
let calls: string[];
/** Mailboxes Google cannot be reached to revoke. */
let unreachable: string[];
const cookies: Record<string, string> = {};
const ids: Record<string, { rule: string; action: number; proposal: number; run: number }> = {};
/** Every `/api/` path some test here has called as a signed-in person. */
const called = new Set<string>();

async function seed(account: string): Promise<void> {
  const db = await dbOf(account);
  await withSampleLabels(db, account);
  const asked = await startLabelProposal(db, { accountId: account, goal: `Quiet ${MARK[account]}`, model: 'p/m', now: 1 });
  await finishLabelProposal(db, account, asked, { drafts: [{ name: `Pitches ${MARK[account]}`, description: 'd', disposition: 'archive', why: 'w' }], now: 2 });
  const mark = MARK[account]!;
  const sender = { address: `sender@${mark}.example.com`, domain: `${mark}.example.com` };
  await recordSync(db, account, [facts({ accountId: account, messageId: `m-${mark}`, subject: `Subject ${mark}`, from: sender })], '2', 1000);
  const decision = await recordDecision(
    db,
    account,
    `m-${mark}`,
    { disposition: 'archive', subscription: 'preserve', stage: 'model', labelId: 'newsletter', reason: `because ${mark}` },
    { now: 1000 },
  );
  const rule = await addRule(db, account, { match: { from: [sender.address] }, disposition: 'archive' }, 'user', 1000);
  const { id: action } = (await raw(db).get<{ id: number }>(
    `INSERT INTO actions (account_id, message_id, type, payload, original_labels, status, created_at, decision_id) VALUES (?, ?, 'archive', '{}', '[]', 'done', 1000, ?) RETURNING id`,
    account,
    `m-${mark}`,
    decision,
  ))!;
  const { id: proposal } = (await raw(db).get<{ id: number }>(
    `INSERT INTO proposals (account_id, match, conditions, label_id, disposition, agreed, created_at) VALUES (?, ?, ?, 'newsletter', 'keep', 2, 1000) RETURNING id`,
    account,
    JSON.stringify({ from: [`proposed@${mark}.example.com`] }),
    conditionsHash(db, { from: [`proposed@${mark}.example.com`] }),
  ))!;
  await raw(db).run(
    `INSERT INTO examples (account_id, message_id, label_id, marked_at, status, body_text, body_html) VALUES (?, ?, 'newsletter', 1000, 'captured', ?, ?)`,
    account,
    `m-${mark}`,
    `Body ${mark}`,
    `<p>Html ${mark}</p>`,
  );
  const run = await startEval({ db, model: `model/${mark}` }, { accountId: account, fewShot: false });
  // Finished, so the next mailbox in the same database can start one.
  await raw(db).run(`UPDATE eval_runs SET status = 'done', finished_at = 1000 WHERE id = ?`, run);
  ids[account] = { rule, action, proposal, run };
}

const call = (method: 'GET' | 'POST', path: string, who: string | null, body?: unknown) => {
  if (who) called.add(new URL(path, 'http://sift').pathname);
  return dashboard.call(method, path, body, who ? { cookie: cookies[who]! } : {});
};

const signIn: SignIn = {
  hasClient: () => true,
  url: (_redirect, state) => `https://accounts.example/auth?state=${state}`,
  // The code stands in for the Google account that came back.
  complete: async (_redirect, code) => code,
};

beforeEach(async () => {
  store = await freshStore();
  calls = [];
  unreachable = [];
  const alpha = await connectAccount(store, ALPHA, '1', 0);
  await connectAccount(store, ALPHA_WORK, '1', 1, alpha);
  await connectAccount(store, BRAVO, '1', 2);
  for (const account of [ALPHA, ALPHA_WORK, BRAVO]) await seed(account);
  await setModel(await dbOf(ALPHA), 'alpha-own-words/model');

  const controls: Controls = {
    models: async () => ({ models: [], shortlist: {}, costs: {} }),
    modelSignIns: async (db) => ({ choices: [], signedIn: [`signed-in-${await personOf(db)}`], pending: null }),
    signInChatGPT: async (db) => (calls.push(`chatgpt ${await personOf(db)}`), { code: 'C', url: 'https://auth.example/device', expiresAt: 1 }),
    finishChatGPT: async (db) => void calls.push(`finish ${await personOf(db)}`),
    saveModelKey: async (db, provider) => void calls.push(`key ${provider} ${await personOf(db)}`),
    signOutModel: async (db, provider) => void calls.push(`signout ${provider} ${await personOf(db)}`),
    undo: async (_db, id) => (calls.push(`undo ${id}`), 'undone'),
    putBack: async () => {},
    ruleFilter: async (_db, id) => void calls.push(`filter ${id}`),
    // Answers with the mail of whoever has the rule: only the route's own check keeps it from someone else.
    ruleInbox: async (_db, id) => {
      calls.push(`inbox ${id}`);
      const owner = Object.keys(ids).find((account) => ids[account]!.rule === id)!;
      return {
        matches: [{ accountId: owner, messageId: 'g', subject: `Inbox ${MARK[owner]}`, receivedAt: 1, seen: false, reads: false }],
        capped: false,
        costEach: null,
      };
    },
    applyRule: async (_db, id) => (calls.push(`apply ${id}`), { deciding: 1, reading: 0 }),
    backfill: async () => void calls.push('backfill'),
    // Answers about Bravo's mailbox whoever asks: only the route's own check keeps it from Alpha.
    pullingIn: async () => [BRAVO],
    startEval: async (_db, { accountId }) => (calls.push(`eval ${accountId}`), 1),
    proposeLabels: async (_db, { accountId, goal }) => (calls.push(`propose ${accountId}`), { id: 1, goal, drafts: [], at: 0 }),
    draftRule: async (_db, { accountId }) => (calls.push(`draft ${accountId}`), { match: { from: ['x@example.com'] }, disposition: 'archive' }),
    revokeGmail: async (_db, email) => (calls.push(`revoke ${email}`), !unreachable.includes(email)),
    // Whatever is asked for, it would answer with that person's mail: only the route's own check keeps it from the wrong person.
    checkNow: async () => void calls.push('check'),
    activity: async () => ({
      running: true,
      lastPassAt: 5,
      problems: [`${ALPHA}: pass failed alpha-home-secret`, `${BRAVO}: pass failed bravo-secret`],
      expired: [ALPHA_WORK, BRAVO],
    }),
  };
  dashboard = await startDashboard(people(store), { controls, signIn, sessionSecret: 'secret', now: () => 2000 });
  for (const who of [ALPHA, ALPHA_WORK, BRAVO]) {
    const login = await dashboard.call('GET', '/auth/login');
    const state = new URL(String(login.headers['location'])).searchParams.get('state');
    const started = String(login.headers['set-cookie']).split(';')[0]!;
    const back = await dashboard.call('GET', `/auth/callback?state=${state}&code=${encodeURIComponent(who)}`, undefined, { cookie: started });
    cookies[who] = String(back.headers['set-cookie']).split(';')[0] ?? '';
  }
});

const READS = (account: string, mark: string) => [
  '/api/summary',
  '/api/decisions',
  `/api/decisions?q=${mark}`,
  '/api/rules',
  '/api/suggestions',
  '/api/suggestions?kept=1',
  '/api/suggestions?kept=1&fact=not-to-you',
  '/api/decisions?days=90&fact=not-to-you',
  '/api/manage',
  '/api/examples',
  '/api/evals',
  `/api/eval?id=${ids[account]!.run}`,
  '/api/models',
  '/api/labels/proposal',
  `/api/message?account=${encodeURIComponent(account)}&id=m-${mark}`,
  `/api/suggestion?account=${encodeURIComponent(account)}&sender=sender@${mark}.example.com`,
  `/api/sender?account=${encodeURIComponent(account)}&address=sender@${mark}.example.com`,
  `/api/domain?account=${encodeURIComponent(account)}&domain=${mark}.example.com`,
  `/api/examples?account=${encodeURIComponent(account)}`,
  `/api/message/html?account=${encodeURIComponent(account)}&id=m-${mark}`,
  `/api/rules/waiting?id=${ids[account]!.rule}`,
  `/api/rules/inbox?id=${ids[account]!.rule}`,
];

describe('users and their mailboxes', () => {
  it('makes the first person the owner, adds a mailbox to whoever connects it, and never moves one', async () => {
    const { central } = store;
    expect(await userOf(central, ALPHA)).toEqual({ id: 1, owner: true });
    expect(await userOf(central, ALPHA_WORK)).toEqual({ id: 1, owner: true });
    expect(await userOf(central, BRAVO)).toMatchObject({ owner: false });
    expect((await userOf(central, BRAVO))!.id).not.toBe(1);
    expect(await mailboxesOf(central, 1)).toEqual([
      { id: ALPHA, primary: true },
      { id: ALPHA_WORK, primary: false },
    ]);
    // Connecting again, even as someone else's, leaves it where it was.
    await connectAccount(store, BRAVO, '9', 5, 1);
    expect(await mailboxesOf(central, 1)).toEqual([
      { id: ALPHA, primary: true },
      { id: ALPHA_WORK, primary: false },
    ]);
    expect(await userOf(central, 'nobody@example.com')).toBeNull();
  });

  it("opens a person's database only for a session that may read it", async () => {
    const alpha = (await people(store).signedIn(ALPHA_WORK))!;
    const bravo = (await userOf(store.central, BRAVO))!.id;
    expect(await alpha.open(alpha.id)).toBe(await dbOf(ALPHA));
    await expect(alpha.open(bravo)).rejects.toThrow(`may not open person ${bravo}'s database`);
    expect(await people(store).signedIn('nobody@example.com')).toBeNull();
  });

  it("keeps each person's mail in a database of their own", async () => {
    const alpha = await dbOf(ALPHA);
    const bravo = await dbOf(BRAVO);
    expect(alpha).not.toBe(bravo);
    expect((await raw(alpha).all<{ id: string }>('SELECT id FROM mailboxes ORDER BY id')).map((m) => m.id)).toEqual([ALPHA, ALPHA_WORK]);
    for (const table of ['mailboxes', 'messages', 'decisions', 'actions', 'rules', 'proposals', 'examples'])
      expect(await raw(bravo).all(`SELECT DISTINCT ${table === 'mailboxes' ? 'id' : 'account_id'} AS id FROM ${table}`), table).toEqual([{ id: BRAVO }]);
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
    // Older mail still coming in is only said to the person whose mailbox it is.
    expect(JSON.parse((await call('GET', '/api/suggestions', ALPHA)).text)).toMatchObject({ importing: false });
    expect(JSON.parse((await call('GET', '/api/suggestions', BRAVO)).text)).toMatchObject({ importing: true });
    // Guidelines and a model sign-in are each person's own.
    expect((await call('GET', '/api/manage', BRAVO)).text).not.toContain('alpha-own-words');
    expect((await call('GET', '/api/manage', ALPHA)).text).toContain('alpha-own-words');
    expect((await call('GET', '/api/manage', BRAVO)).text).not.toContain('signed-in-1');
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
    const summary = JSON.parse((await call('GET', `/api/summary?mailbox=${encodeURIComponent(ALPHA_WORK)}`, ALPHA)).text) as { totals: { decided: number } };
    expect(summary.totals.decided).toBe(1);
    // Narrowed by a fact, a list is still only theirs.
    for (const path of ['/api/decisions?days=90&fact=not-to-you', '/api/suggestions?kept=1&fact=not-to-you']) {
      const narrowed = (await call('GET', path, ALPHA)).text;
      expect(narrowed).toContain(MARK[ALPHA]);
      expect(narrowed).toContain(MARK[ALPHA_WORK]);
      expect(narrowed).not.toContain(MARK[BRAVO]);
      const work = (await call('GET', `${path}&mailbox=${encodeURIComponent(ALPHA_WORK)}`, ALPHA)).text;
      expect(work).toContain(MARK[ALPHA_WORK]);
      expect(work).not.toContain(MARK[ALPHA]);
    }
    // A message's HTML, from any of their own mailboxes.
    const html = await call('GET', `/api/message/html?account=${encodeURIComponent(ALPHA_WORK)}&id=m-${MARK[ALPHA_WORK]}`, ALPHA);
    expect(html.status).toBe(200);
    expect(html.text).toContain(MARK[ALPHA_WORK]);
    // Someone else's mailbox is not one that can be asked for.
    expect((await call('GET', `/api/rules?mailbox=${encodeURIComponent(BRAVO)}`, ALPHA)).status).toBe(404);
    expect((await call('GET', '/api/rules', null)).status).toBe(401);
  });

  it("refuses every write to another person's mailbox as if it were not there, and changes nothing", async () => {
    // Ids are numbered within each person's database: these are ones Bravo's has none of.
    const theirs = ids[ALPHA_WORK]!;
    expect(theirs.action).not.toBe(ids[BRAVO]!.action);
    const db = await dbOf(ALPHA);
    const state = async () =>
      JSON.stringify([
        await listRules(db, ALPHA),
        await raw(db).all('SELECT * FROM labels'),
        await raw(db).all('SELECT * FROM proposals'),
        await raw(db).all('SELECT * FROM model_runs'),
      ]);
    const before = await state();
    const NOBODY = 'nobody@example.com';
    // Each write, and the same write naming something nobody has: the answers must not tell them apart.
    const writes: [string, Record<string, unknown>, Record<string, unknown>][] = [
      [
        '/api/feedback',
        { accountId: ALPHA, sender: `sender@${MARK[ALPHA]}.example.com`, label: 'newsletter', disposition: 'keep', messageId: `m-${MARK[ALPHA]}` },
        { accountId: NOBODY, sender: `sender@${MARK[ALPHA]}.example.com`, label: 'newsletter', disposition: 'keep', messageId: `m-${MARK[ALPHA]}` },
      ],
      [
        '/api/rules',
        { accountId: ALPHA, match: { from: ['x@example.com'] }, disposition: 'spam' },
        { accountId: NOBODY, match: { from: ['x@example.com'] }, disposition: 'spam' },
      ],
      [
        '/api/standing',
        { accountId: ALPHA, address: `sender@${MARK[ALPHA]}.example.com`, standing: 'blocked' },
        { accountId: NOBODY, address: `sender@${MARK[ALPHA]}.example.com`, standing: 'blocked' },
      ],
      [
        '/api/standing/clear',
        { accountId: ALPHA, address: `sender@${MARK[ALPHA]}.example.com` },
        { accountId: NOBODY, address: `sender@${MARK[ALPHA]}.example.com` },
      ],
      [
        '/api/rules',
        { accountId: ALPHA, match: { from: ['x@example.com'] }, label: 'newsletter', proposal: theirs.proposal },
        { accountId: NOBODY, match: { from: ['x@example.com'] }, label: 'newsletter', proposal: 9999 },
      ],
      // Their own mailbox, with a proposal of someone else's: none of theirs has that id.
      [
        '/api/rules',
        { accountId: BRAVO, match: { from: ['x@example.com'] }, label: 'newsletter', proposal: theirs.proposal },
        { accountId: BRAVO, match: { from: ['x@example.com'] }, label: 'newsletter', proposal: 9999 },
      ],
      ['/api/rules/remove', { id: theirs.rule }, { id: 'r-nobody' }],
      ['/api/rules/filter', { id: theirs.rule, on: true }, { id: 'r-nobody', on: true }],
      ['/api/rules/apply', { id: theirs.rule, messageIds: ['g'] }, { id: 'r-nobody', messageIds: ['g'] }],
      ['/api/proposals', { id: theirs.proposal }, { id: 9999 }],
      ['/api/undo', { id: theirs.action }, { id: 9999 }],
      ['/api/examples/delete', { accountId: ALPHA, messageId: `m-${MARK[ALPHA]}` }, { accountId: NOBODY, messageId: `m-${MARK[ALPHA]}` }],
      ['/api/examples/delete-all', { accountId: ALPHA }, { accountId: NOBODY }],
      ['/api/evals/run', { accountId: ALPHA }, { accountId: NOBODY }],
      ['/api/rules/draft', { accountId: ALPHA, goal: 'Archive x' }, { accountId: NOBODY, goal: 'Archive x' }],
      ['/api/mailbox/remove', { address: ALPHA }, { address: NOBODY }],
      ['/api/mailbox/primary', { address: ALPHA }, { address: NOBODY }],
    ];
    for (const [path, body, nobody] of writes) {
      const answer = await call('POST', path, BRAVO, body);
      expect(answer.status, `${path} as someone else`).toBeGreaterThanOrEqual(400);
      expect(answer.text).not.toContain(MARK[ALPHA]);
      expect(answer.status, `${path}: someone else's is told apart from nobody's`).toBe((await call('POST', path, BRAVO, nobody)).status);
    }
    expect(await state()).toBe(before);
    expect(await raw(db).get('SELECT count(*) AS n FROM examples WHERE account_id = ?', ALPHA)).toEqual({ n: 1 });
    expect(calls).toEqual([]);

    // The same writes are the owner's to make on their own mail.
    expect((await call('GET', `/api/rules/inbox?id=${theirs.rule}`, ALPHA)).text).toContain(MARK[ALPHA_WORK]);
    expect((await call('POST', '/api/rules/apply', ALPHA, { id: theirs.rule, messageIds: ['g'] })).status).toBe(200);
    expect((await call('POST', '/api/rules/draft', ALPHA, { accountId: ALPHA_WORK, goal: 'Archive x' })).status).toBe(200);
    expect(calls).toEqual([`inbox ${theirs.rule}`, `apply ${theirs.rule}`, `draft ${ALPHA_WORK}`]);
    expect((await call('POST', '/api/rules/remove', ALPHA, { id: theirs.rule })).status).toBe(200);
    const fromProposal = { accountId: ALPHA_WORK, match: { from: ['x@example.com'] }, label: 'newsletter', proposal: theirs.proposal };
    expect((await call('POST', '/api/rules', ALPHA, fromProposal)).status).toBe(200);
    expect(await raw(db).get('SELECT status FROM proposals WHERE id = ?', theirs.proposal)).toEqual({ status: 'accepted' });
    expect((await call('POST', '/api/undo', ALPHA_WORK, { id: theirs.action })).status).toBe(200);
  });

  it('lets each person change their own mode, model and sign-ins, and only their own', async () => {
    const bravo = (await userOf(store.central, BRAVO))!.id;
    for (const [path, body] of [
      ['/api/active', { active: true }],
      ['/api/model', { model: 'openai/small' }],
      ['/api/model/chatgpt', {}],
      ['/api/model/chatgpt/finish', { address: 'http://127.0.0.1:1455/auth/callback?code=c' }],
      ['/api/model/key', { provider: 'openai', key: 'k' }],
      ['/api/model/signout', { provider: 'openai' }],
    ] as const)
      expect((await call('POST', path, BRAVO, body)).status, path).toBe(200);
    expect(calls.filter((c) => c !== 'check')).toEqual([`chatgpt ${bravo}`, `finish ${bravo}`, `key openai ${bravo}`, `signout openai ${bravo}`]);
    expect(await preferences(await dbOf(BRAVO))).toMatchObject({ active: true, model: 'openai/small' });
    expect(await preferences(await dbOf(ALPHA))).toMatchObject({ active: false, model: 'alpha-own-words/model' });
    expect((await call('GET', '/api/manage', BRAVO)).body).toMatchObject({ active: true });
    expect((await call('GET', '/api/manage', ALPHA)).body).toMatchObject({ active: false });
    expect((await call('POST', '/api/model', null, { model: 'nobody/model' })).status).toBe(401);
  });

  it('lets each person change their own labels, and only their own', async () => {
    const alpha = await dbOf(ALPHA);
    const labels = async () =>
      JSON.stringify([await raw(alpha).all('SELECT * FROM labels ORDER BY account_id, id'), await raw(alpha).all('SELECT * FROM label_proposals')]);
    const before = await labels();
    const bravo = await dbOf(BRAVO);
    const label = { name: 'Bravo only', description: 'Mail only Bravo has.', disposition: 'archive' };
    expect((await call('POST', '/api/labels', BRAVO, { id: 'newsletter', name: 'Bravo reading' })).status).toBe(200);
    expect((await call('POST', '/api/labels/add', BRAVO, { labels: [label] })).status).toBe(200);
    expect((await call('POST', '/api/labels/propose', BRAVO, { goal: 'Less noise' })).status).toBe(200);
    // Bravo's mailbox has labels already, so there is nothing to accept into: refused, and Alpha's untouched either way.
    expect((await call('POST', '/api/labels/accept', BRAVO, { labels: [label] })).status).toBe(409);
    expect(calls).toEqual([`propose ${BRAVO}`]);
    expect((await listLabels(bravo, BRAVO)).map((l) => l.name)).toEqual(expect.arrayContaining(['Bravo reading', 'Bravo only']));
    // Alpha has a label by this id too.
    expect((await call('POST', '/api/labels/remove', BRAVO, { id: 'newsletter' })).status).toBe(200);
    expect((await listLabels(bravo, BRAVO)).map((l) => l.id)).not.toContain('newsletter');
    expect(await labels()).toBe(before);
  });

  it('lets only the person who set sift up change what applies to everyone', async () => {
    expect((await call('POST', '/api/backfill', BRAVO, { days: 1 })).status, 'as a guest').toBe(403);
    expect((await call('POST', '/api/backfill', ALPHA_WORK, { days: 1 })).status, 'as the owner').toBe(200);
    expect(calls.filter((c) => c !== 'check')).toEqual(['backfill']);
    // Asking sift to look now is nobody's secret.
    expect((await call('POST', '/api/check', BRAVO, {})).status).toBe(200);
  });

  it("will not delete someone else's account, even given their address", async () => {
    const before = await rowsBy('user_id');
    expect((await call('POST', '/api/account/delete', BRAVO, { address: ALPHA })).status).toBe(409);
    expect((await call('POST', '/api/account/delete', null, { address: ALPHA })).status).toBe(401);
    expect(await rowsBy('user_id')).toEqual(before);
    expect(calls).toEqual([]);
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

describe('removing a mailbox and deleting an account', () => {
  const alpha = 1;
  const signedOut = (reply: { headers: Record<string, string | string[] | undefined> }) =>
    String(reply.headers['set-cookie'] ?? '').startsWith('sift_session=;');
  /** Every row anywhere that is about `account`, by table. */
  const about = async (account: string) =>
    Object.fromEntries(Object.entries(await rowsBy('account_id')).flatMap(([table, counts]) => (counts[account] ? [[table, counts[account]]] : [])));

  beforeEach(async () => {
    for (const account of [ALPHA, ALPHA_WORK, BRAVO])
      await raw(await dbOf(account)).run(`INSERT INTO credentials (kind, key, value) VALUES ('gmail', ?, 'token')`, account);
  });

  it('makes one of their own mailboxes primary, whichever they signed in with, and hands it on when it is removed', async () => {
    const primary = async (who: string) =>
      ((await call('GET', '/api/manage', who)).body['accounts'] as { email: string; primary: boolean }[]).filter((a) => a.primary).map((a) => a.email);
    expect(await primary(ALPHA_WORK)).toEqual([ALPHA]);
    expect((await call('POST', '/api/mailbox/primary', ALPHA, { address: ALPHA_WORK })).status).toBe(200);
    expect(await primary(ALPHA)).toEqual([ALPHA_WORK]);
    expect(await primary(BRAVO)).toEqual([BRAVO]);
    await call('POST', '/api/mailbox/remove', ALPHA, { address: ALPHA_WORK });
    expect(await primary(ALPHA)).toEqual([ALPHA]);
  });

  it('removes a mailbox, revoking its access first, and leaves the rest of the person and everyone else', async () => {
    const bravoBefore = await about(BRAVO);
    const alphaBefore = await about(ALPHA);
    expect(Object.keys(await about(ALPHA_WORK)).length).toBeGreaterThan(5);
    // Typed wrong, or not theirs: nothing happens.
    expect((await call('POST', '/api/mailbox/remove', ALPHA, { address: 'alpha@work.example.co' })).status).toBe(404);

    const removed = await call('POST', '/api/mailbox/remove', ALPHA, { address: ALPHA_WORK });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ notRevoked: [], signedOut: false });
    expect(signedOut(removed)).toBe(false);
    expect(calls).toEqual([`revoke ${ALPHA_WORK}`]);
    expect(await about(ALPHA_WORK)).toEqual({});
    expect(await about(ALPHA)).toEqual(alphaBefore);
    expect(await about(BRAVO)).toEqual(bravoBefore);
    expect(await raw(await dbOf(ALPHA)).all(`SELECT key FROM credentials WHERE kind = 'gmail'`)).toEqual([{ key: ALPHA }]);
    expect(await connectedAddresses(store.central)).toEqual([ALPHA, BRAVO]);
    // Still signed in as the one left, and still the owner.
    expect((await call('GET', '/api/manage', ALPHA)).body).toMatchObject({ owner: true, accounts: [{ email: ALPHA }] });
    // The one removed signs no one in any more.
    expect((await call('GET', '/api/manage', ALPHA_WORK)).status).toBe(401);
  });

  it('signs out whoever removes the mailbox they are signed in as, and says when Google could not be reached', async () => {
    unreachable = [ALPHA_WORK];
    const removed = await call('POST', '/api/mailbox/remove', ALPHA_WORK, { address: ALPHA_WORK });
    expect(removed.body).toEqual({ notRevoked: [ALPHA_WORK], signedOut: true });
    expect(signedOut(removed)).toBe(true);
    expect(await about(ALPHA_WORK)).toEqual({});
    expect((await call('GET', '/api/manage', ALPHA_WORK)).status).toBe(401);
    expect((await call('GET', '/api/manage', ALPHA)).status).toBe(200);
  });

  it('deletes everything of the person, hands the install to the earliest left, and signs them out', async () => {
    const before = await rowsBy('user_id');
    const bravo = (await userOf(store.central, BRAVO))!.id;
    expect((await call('POST', '/api/account/delete', ALPHA, { address: 'someone@example.com' })).status).toBe(409);
    expect(await rowsBy('user_id')).toEqual(before);

    const deleted = await call('POST', '/api/account/delete', ALPHA, { address: ALPHA_WORK });
    expect(deleted.body).toEqual({ notRevoked: [], signedOut: true });
    expect(signedOut(deleted)).toBe(true);
    expect(calls).toEqual([`revoke ${ALPHA}`, `revoke ${ALPHA_WORK}`]);
    const after = await rowsBy('user_id');
    for (const [table, counts] of Object.entries(before)) expect(after[table], table).toEqual(counts[bravo] ? { [bravo]: counts[bravo] } : {});
    expect(await listUsers(store.central)).toEqual([{ id: bravo, owner: true }]);
    for (const who of [ALPHA, ALPHA_WORK]) expect((await call('GET', '/api/manage', who)).status).toBe(401);
    expect((await call('GET', '/api/manage', BRAVO)).body).toMatchObject({ owner: true });
  });

  it("never removes a person's only mailbox on its own, and with nobody left the next sign-in owns the install", async () => {
    const before = await rowsBy('user_id');
    const refused = await call('POST', '/api/mailbox/remove', BRAVO, { address: BRAVO });
    expect(refused.status).toBe(409);
    expect(refused.text).toContain('only remaining mailbox');
    expect(await rowsBy('user_id')).toEqual(before);
    expect((await call('POST', '/api/account/delete', BRAVO, { address: BRAVO })).status).toBe(200);
    expect((await call('POST', '/api/account/delete', ALPHA, { address: ALPHA })).status).toBe(200);
    expect(await listUsers(store.central)).toEqual([]);
    expect(Object.values(await rowsBy('user_id')).every((counts) => Object.keys(counts).length === 0)).toBe(true);
    await connectAccount(store, 'carol@example.com', '1', 3);
    expect(await userOf(store.central, 'carol@example.com')).toMatchObject({ owner: true });
  });

  it("refuses a session whose address has since become someone else's", async () => {
    expect((await call('POST', '/api/mailbox/remove', ALPHA, { address: ALPHA_WORK })).status).toBe(200);
    // Someone new signs in as the address: it is a new person, and the old session is not theirs.
    await connectAccount(store, ALPHA_WORK, '1', 9);
    expect((await userOf(store.central, ALPHA_WORK))!.id).not.toBe(alpha);
    expect((await call('GET', '/api/manage', ALPHA_WORK)).status).toBe(401);
  });
});

// Runs last: it reads what every test above called.
describe('every route', () => {
  it('is called above as a signed-in person', () => {
    const missing = [...api.READS, ...api.WRITES, ...api.FRAMES].map((route) => route.path).filter((path) => !called.has(path));
    expect(missing, 'add these to the reads or writes above, called as someone whose data it is not').toEqual([]);
  });
});
