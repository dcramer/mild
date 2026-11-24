import type { Sql } from '../src/store/sql.ts';
import { describe, expect, it } from 'vitest';
import { execute } from '../src/actions/executor.ts';
import { listDecisions } from '../src/dashboard/queries/decisions.ts';
import { summarize } from '../src/dashboard/queries/summary.ts';
import { usage } from '../src/dashboard/queries/usage.ts';
import type { Controls } from '../src/dashboard/controls.ts';
import { preferences } from '../src/store/preferences.ts';
import { people } from '../src/store/people.ts';
import { recordSync } from '../src/store/messages.ts';
import { finishAction, insertPendingAction, setActionStatus } from '../src/store/actions.ts';
import { recordDecision, settleDecision } from '../src/store/decisions.ts';
import { connectGmail, fakeGoogle, modelRun, openUserDb, raw, startDashboard, onePerson, unmarked } from './fixtures.ts';
import type { Store } from '../src/store/store.ts';
import { ACCOUNT, DAY, codeSignIn, everything, facts, email } from './helpers.ts';

const fake = fakeGoogle();
const NOW = Date.UTC(2026, 5, 15, 12);

/** A model call two days ago that cost `costUsd`. */
const charged = async (db: Sql, messageId: string, costUsd: number, error?: string) =>
  await modelRun(db, {
    messageId,
    model: 'test-model',
    at: NOW - 2 * DAY,
    usage: { model: 'test-model', inputTokens: 900, outputTokens: 100, costUsd },
    error,
  });

async function seededStore(): Promise<{ store: Store; db: Sql }> {
  const { store, db } = await onePerson(ACCOUNT);
  await recordSync(
    db,
    ACCOUNT,
    [
      facts({
        messageId: 'a',
        subject: 'Weekly digest',
        receivedAt: NOW - DAY,
        from: email('news@example.com', 'Example News'),
      }),
      facts({ messageId: 'b', subject: 'Second digest', receivedAt: NOW - DAY }),
      facts({
        messageId: 'c',
        subject: '<img src=x onerror=alert(1)>',
        receivedAt: NOW - 2 * DAY,
        from: email('cold@example.net'),
      }),
      facts({ messageId: 'old', receivedAt: NOW - 40 * DAY }),
      facts({ messageId: 'waiting', receivedAt: NOW }),
    ],
    '2',
    NOW,
  );
  const base = { subscription: 'preserve', reason: 'test' } as const;
  await recordDecision(
    db,
    ACCOUNT,
    'a',
    { ...base, disposition: 'archive', stage: 'rules', ruleId: 'r1', labelId: 'newsletter', gmailLabel: 'mild/newsletters' },
    { now: NOW - DAY },
  );
  await recordDecision(db, ACCOUNT, 'b', { ...base, disposition: 'archive', stage: 'classifier' }, { now: NOW - DAY });
  await recordDecision(
    db,
    ACCOUNT,
    'c',
    { ...base, disposition: 'review', stage: 'model', confidence: 0.4 },
    { now: NOW - 2 * DAY, durationMs: 1500, runId: await charged(db, 'c', 0.02) },
  );
  // A call that failed costs too, and decided nothing.
  await charged(db, 'b', 0.01, 'failed');
  await recordDecision(db, ACCOUNT, 'old', { ...base, disposition: 'keep', stage: 'rules' }, { now: NOW - 40 * DAY });
  return { store, db };
}
const seeded = async () => (await seededStore()).db;

describe('tracking', () => {
  it('stores the headers with each message, and never a body', async () => {
    const db = await openUserDb(ACCOUNT);
    await recordSync(db, ACCOUNT, [facts({ messageId: 'a', headers: { 'list-id': '<dev.lists.example.com>' }, cc: [email('c@example.org')] })], '2', NOW);
    const row = (await raw(db).get<{ headers: string }>('SELECT * FROM messages'))!;
    expect(row).toMatchObject({ synced_at: NOW, label_ids: ['INBOX', 'UNREAD'] });
    expect(JSON.parse(unmarked(row.headers))).toMatchObject({ subject: 'Weekly digest', cc: 'c@example.org', 'list-id': '<dev.lists.example.com>' });
    expect(Object.keys(row).some((k) => /body|snippet|content/.test(k))).toBe(false);
  });

  it('keeps every decision for a message, with its cost', async () => {
    const db = await seeded();
    await recordDecision(db, ACCOUNT, 'c', { disposition: 'keep', subscription: 'preserve', stage: 'rules', reason: 'user correction' }, { now: NOW });
    const rows = await raw(db).all(
      `SELECT d.stage, d.disposition, r.model, r.cost_usd, r.input_tokens, d.duration_ms FROM decisions d LEFT JOIN model_runs r ON r.id = d.run_id WHERE d.message_id = 'c' ORDER BY d.id`,
    );
    expect(rows).toEqual([
      { stage: 'model', disposition: 'review', model: 'test-model', cost_usd: 0.02, input_tokens: 900, duration_ms: 1500 },
      { stage: 'rules', disposition: 'keep', model: null, cost_usd: null, input_tokens: null, duration_ms: null },
    ]);
  });

  it('links an action to the decision it carried out', async () => {
    const db = await seeded();
    const { mailbox, gmail } = connectGmail(fake.google);
    gmail.deliver({ id: 'a', from: 'news@example.com', labelIds: ['INBOX'] });
    await execute({ db, mailbox, now: () => NOW }, ACCOUNT, 'a', { type: 'archive' }, 1);
    expect(await raw(db).get('SELECT decision_id, status FROM actions')).toEqual({ decision_id: 1, status: 'done' });
    expect(gmail.labelsOf('a')).not.toContain('INBOX');
    expect((await summarize(db, await everything(db), 7, NOW)).recent.find((r) => r.id === 1)).toMatchObject({
      actionId: 1,
      actionStatus: 'done',
    });
  });

  it('groups decisions by where they got to, and shows the mailbox change rather than an unsubscribe', async () => {
    const db = await seeded();
    const base = { subscription: 'preserve', reason: 'test', stage: 'rules' } as const;
    const done = await recordDecision(db, ACCOUNT, 'a', { ...base, disposition: 'archive' }, { carryOut: true, now: NOW });
    const archived = await insertPendingAction(
      db,
      { accountId: ACCOUNT, messageId: 'a', type: 'archive', payload: { add: [], remove: ['INBOX'] }, originalLabels: ['INBOX'], decisionId: done },
      NOW,
    );
    await finishAction(db, archived, 'done', [], null, NOW);
    const unsubscribed = await insertPendingAction(
      db,
      { accountId: ACCOUNT, messageId: 'a', type: 'unsubscribe', payload: { add: [], remove: [] }, originalLabels: [], decisionId: done },
      NOW,
    );
    await finishAction(db, unsubscribed, 'done', null, null, NOW);
    await settleDecision(db, done, 'done');
    const failed = await recordDecision(db, ACCOUNT, 'b', { ...base, disposition: 'archive' }, { carryOut: true, now: NOW });
    await settleDecision(db, failed, 'failed', 'Gmail answered 503');
    const ids = async (status: string) => (await listDecisions(db, await everything(db), { days: 7, status }, NOW)).rows.map((r) => r.id);

    expect(await ids('suggested')).toEqual([3, 2, 1]);
    expect(await ids('done')).toEqual([done]);
    expect(await ids('nonsense')).toEqual([]);
    expect((await listDecisions(db, await everything(db), { days: 7, status: 'done' }, NOW)).rows[0]).toMatchObject({ actionId: archived });

    await setActionStatus(db, archived, 'undone');
    expect(await ids('undone')).toEqual([done]);
    expect(await ids('done')).toEqual([]);
    // What changed in Gmail, or was tried: not the suggestions, which never touched it.
    expect(await ids('changed')).toEqual([failed, done]);

    // An answer waiting for the next pass is shown among the changes.
    const answer = await recordDecision(db, ACCOUNT, 'c', { ...base, disposition: 'archive' }, { carryOut: true, byUser: true, now: NOW });
    expect(await ids('changed')).toEqual([answer, failed, done]);
  });

  it('sums what the model cost over a day, a week and 30 days, failed calls included, and per day for the 30', async () => {
    const { db } = await onePerson(ACCOUNT);
    await recordSync(db, ACCOUNT, [facts({ messageId: 'a', receivedAt: NOW - 50 * DAY })], '1', NOW);
    for (const [ago, costUsd, error] of [
      [2 * 3_600_000, 0.01, false],
      [3 * DAY, 0.02, true],
      [20 * DAY, 0.04, false],
      [40 * DAY, 1, false],
    ] as const) {
      await modelRun(db, {
        messageId: 'a',
        model: 'test-model',
        at: NOW - ago,
        usage: { model: 'test-model', inputTokens: 1, outputTokens: 1, costUsd },
        error: error ? 'failed' : undefined,
      });
    }
    const used = await usage(db, await everything(db), NOW);
    expect(used.day).toBeCloseTo(0.01);
    expect(used.week).toBeCloseTo(0.03);
    expect(used.month).toBeCloseTo(0.07);
    expect(used.daily).toHaveLength(30);
    expect(used.daily.at(-1)).toBeCloseTo(0.01);
    expect(used.daily.at(-4)).toBeCloseTo(0.02);
    expect(used.daily.reduce((a, b) => a + b)).toBeCloseTo(0.07);
  });

  it('counts only the window and reports tiers, cost and backlog', async () => {
    const db = await seeded();
    const summary = await summarize(db, await everything(db), 7, NOW);
    expect(summary.totals).toEqual({ messages: 4, decided: 3, withoutInference: 2, judged: 2, costUsd: 0.03, awaitingTriage: 1 });
    expect(summary.byStage.map((s) => [s.stage, s.decisions])).toEqual([
      ['rules', 1],
      ['classifier', 1],
      ['model', 1],
      ['fallback', 0],
    ]);
    expect(summary.byStage.find((s) => s.stage === 'model')).toMatchObject({ costUsd: 0.02, tokens: 1000 });
    expect(summary.byDisposition).toEqual([
      { disposition: 'archive', decisions: 2 },
      { disposition: 'review', decisions: 1 },
    ]);
    expect(summary.accounts).toEqual([{ email: ACCOUNT, lastSyncedAt: NOW }]);
  });

  it('counts messages, not decisions: answers and decisions made again are the same message', async () => {
    const db = await seeded();
    const base = { subscription: 'preserve', reason: 'test' } as const;
    // The user answers 'a' and 'c'; a label change decides 'b' again.
    await recordDecision(db, ACCOUNT, 'a', { ...base, disposition: 'keep', stage: 'rules' }, { carryOut: true, byUser: true, now: NOW });
    await recordDecision(db, ACCOUNT, 'c', { ...base, disposition: 'archive', stage: 'rules' }, { carryOut: true, byUser: true, now: NOW });
    await recordDecision(db, ACCOUNT, 'b', { ...base, disposition: 'keep', stage: 'classifier' }, { now: NOW });
    // A message the model could not judge, answered by the user: no model decided it, but neither did sift.
    await recordSync(db, ACCOUNT, [facts({ messageId: 'failed', receivedAt: NOW })], '3', NOW);
    await charged(db, 'failed', 0.005, 'failed');
    await charged(db, 'failed', 0.005, 'failed');
    await recordDecision(db, ACCOUNT, 'failed', { ...base, disposition: 'archive', stage: 'rules' }, { carryOut: true, byUser: true, now: NOW });

    const summary = await summarize(db, await everything(db), 7, NOW);
    expect(summary.totals).toMatchObject({ decided: 3, withoutInference: 2, judged: 3, costUsd: expect.closeTo(0.04) });
    expect(summary.daily.reduce((sum, d) => sum + Object.values(d.counts).reduce((a, b) => a + b, 0), 0)).toBe(3);
    expect(summary.byStage.map((s) => s.decisions)).toEqual([1, 1, 1, 0]);
  });

  it('returns one entry per day, including empty days', async () => {
    const db = await seeded();
    const { daily } = await summarize(db, await everything(db), 7, NOW);
    expect(daily).toHaveLength(7);
    expect(daily.reduce((sum, d) => sum + Object.values(d.counts).reduce((a, b) => a + b, 0), 0)).toBe(3);
    expect(daily.at(-1)?.counts).toEqual({ rules: 0, classifier: 0, model: 0, fallback: 0 });
  });

  it('says per day how much of the mail was one label, only when asked', async () => {
    const db = await seeded();
    const labelled = async (label?: string) => (await summarize(db, await everything(db), 7, NOW, label)).daily.map((d) => d.labelled);
    expect((await labelled()).every((n) => n === undefined)).toBe(true);
    expect((await labelled('newsletter')).reduce((a = 0, b = 0) => a + b, 0)).toBe(1);
    expect((await labelled('nope')).every((n) => n === 0)).toBe(true);
  });

  it('says per day what was done in Gmail, what failed, and what the model cost', async () => {
    const db = await seeded();
    const base = { subscription: 'preserve', reason: 'test', stage: 'rules' } as const;
    const archived = await recordDecision(db, ACCOUNT, 'a', { ...base, disposition: 'archive' }, { carryOut: true, now: NOW });
    const change = await insertPendingAction(
      db,
      { accountId: ACCOUNT, messageId: 'a', type: 'archive', payload: { add: [], remove: ['INBOX'] }, originalLabels: ['INBOX'], decisionId: archived },
      NOW,
    );
    await finishAction(db, change, 'done', [], null, NOW);
    await settleDecision(db, archived, 'done');
    await settleDecision(
      db,
      await recordDecision(db, ACCOUNT, 'b', { ...base, disposition: 'spam' }, { carryOut: true, now: NOW }),
      'failed',
      'Gmail answered 503',
    );
    const { daily } = await summarize(db, await everything(db), 7, NOW);
    // A change that never landed changed nothing.
    expect(daily.at(-1)?.changes).toEqual({ archive: 1, spam: 0, keep: 0 });
    // Suggestions changed nothing, so the other days have no changes; the model's cost is on the day it was asked.
    expect(daily.slice(0, -1).every((d) => d.changes.archive + d.changes.spam + d.changes.keep === 0)).toBe(true);
    expect(daily.reduce((sum, d) => sum + d.costUsd, 0)).toBeCloseTo(0.03);
  });

  it('lists senders and recent decisions with their message', async () => {
    const db = await seeded();
    const summary = await summarize(db, await everything(db), 7, NOW);
    expect(summary.topSenders[0]).toEqual({ address: 'news@example.com', messages: 3, lastDisposition: 'keep' });
    expect(summary.recent.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(summary.recent[2]).toMatchObject({
      subject: 'Weekly digest',
      fromName: 'Example News',
      stage: 'rules',
      labelId: 'newsletter',
      gmailLabel: 'mild/newsletters',
      actionId: null,
    });
  });

  it('handles an empty database', async () => {
    const empty = await openUserDb();
    const summary = await summarize(empty, await everything(empty), 30, NOW);
    expect(summary.totals.decided).toBe(0);
    expect(summary.daily).toHaveLength(30);
    expect(summary.recent).toEqual([]);
  });
});

describe('dashboard server', () => {
  /** The dashboard's address, over `store` or else a newly seeded one. */
  async function start(options: Parameters<typeof startDashboard>[1] = {}, store?: Store) {
    const over = store ?? (await seededStore()).store;
    return (await startDashboard(people(over), { now: () => NOW, ...options })).base;
  }

  it('refuses every write that did not come from its own page, before it reaches what acts', async () => {
    const { store, db } = await seededStore();
    const asked: string[] = [];
    const controls = new Proxy({}, { get: (_, name) => async () => void asked.push(String(name)) }) as Controls;
    const { call } = await startDashboard(people(store), { controls });
    for (const path of [
      '/api/active',
      '/api/labels',
      '/api/labels/add',
      '/api/rules',
      '/api/rules/remove',
      '/api/rules/filter',
      '/api/rules/apply',
      '/api/undo',
      '/api/inbox/start',
      '/api/inbox/stop',
      '/api/check',
      '/api/feedback',
    ]) {
      expect((await call('POST', path, { active: true }, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await call('POST', path, { active: true }, { 'x-sift': '' })).status).toBe(403);
    }
    expect((await call('POST', '/api/nope', {})).status).toBe(405);
    expect((await preferences(db)).active).toBe(false);
    expect(asked).toEqual([]);
  });

  it('can only look, not manage, when no controls are given', async () => {
    const { call } = await startDashboard(people((await seededStore()).store));
    expect((await call('POST', '/api/undo', { id: 1 })).status).toBe(409);
    expect((await call('GET', '/api/manage')).body).toMatchObject({ activity: { running: false } });
  });

  it("tells the page only that something failed when it is Mild's own error, and logs why", async () => {
    const { store, db } = await seededStore();
    await raw(db).run("UPDATE messages SET headers = 'sift-secret:v1:deadbeef:x:y' WHERE id = 'c'");
    const logged: string[] = [];
    const base = await start({ log: (line) => logged.push(line) }, store);
    const reply = await fetch(`${base}/api/message?id=c`);
    expect([reply.status, await reply.json()]).toEqual([500, { error: 'Mild could not do that. Why is in its log.' }]);
    expect(logged).toEqual([expect.stringMatching(/^GET \/api\/message: .*MILD_KEY/)]);
  });

  it('lets someone sign in behind tailscale serve, which tells this machine the browser used HTTPS', async () => {
    const { store } = await seededStore();
    const dashboard = await startDashboard(people(store), { signIn: codeSignIn, sessionSecret: 'secret', allowedHosts: ['devbox.tail1234.ts.net'] });
    const session = async (headers: Record<string, string>) =>
      (await dashboard.call('GET', '/api/session', undefined, { host: 'devbox.tail1234.ts.net', ...headers })).body;
    expect(await session({})).toMatchObject({ canSignIn: false, reason: 'address' });
    expect(await session({ 'x-forwarded-proto': 'https' })).toMatchObject({ canSignIn: true, reason: null });
    // Listening beyond loopback, anyone could say it.
    const anywhere = await startDashboard(people(store), {
      signIn: codeSignIn,
      sessionSecret: 'secret',
      allowedHosts: ['devbox.tail1234.ts.net'],
      forwarded: false,
    });
    const claimed = await anywhere.call('GET', '/api/session', undefined, { host: 'devbox.tail1234.ts.net', 'x-forwarded-proto': 'https' });
    expect(claimed.body).toMatchObject({ canSignIn: false, reason: 'address' });
  });

  it('rejects bad input, other methods and unknown paths', async () => {
    const base = await start();
    expect((await fetch(`${base}/api/summary?days=5000`)).status).toBe(400);
    expect((await fetch(`${base}/api/summary`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it('answers only to localhost and to hosts the user configured', async () => {
    const { request } = await import('node:http');
    const statusFor = (base: string, host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(`${base}/api/summary`, { headers: { host } }, (res) => resolve(res.statusCode ?? 0));
        req.on('error', reject);
        req.end();
      });

    const { store } = await seededStore();
    const base = await start({}, store);
    expect(await statusFor(base, 'evil.example')).toBe(403);
    expect(await statusFor(base, '100.64.0.7:8787')).toBe(403);

    const configured = await start({ allowedHosts: ['Box.example.ts.net', '100.64.0.7'] }, store);
    expect(await statusFor(configured, 'box.example.ts.net:8787')).toBe(200);
    expect(await statusFor(configured, '100.64.0.7')).toBe(200);
    expect(await statusFor(configured, 'localhost:1')).toBe(200);
    expect(await statusFor(configured, 'evil.example')).toBe(403);
  });
});
