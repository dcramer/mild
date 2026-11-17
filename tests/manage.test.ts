import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { continueInboxRun } from '../src/work/inbox.ts';
import { REACH, goingInboxRuns, inboxProgress, modelShare, startInboxRuns, stopInboxRuns } from '../src/store/inbox.ts';
import { averageCall, finishRun, startRun } from '../src/store/runs.ts';
import { memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { type RunOptions, tick } from '../src/work/run.ts';
import { triageAccount } from '../src/work/triage.ts';
import type { Controls, SignIn } from '../src/dashboard/controls.ts';
import { people } from '../src/store/people.ts';
import type { RawMessage } from '../src/gmail/api.ts';
import { continueEval, startEval } from '../src/learn/evals.ts';
import { redecideWaiting } from '../src/learn/redecide.ts';
import { connectAccount, listAccounts, recordSync } from '../src/store/accounts.ts';
import { MAX_LABELS, listLabels } from '../src/store/labels.ts';
import { LEAVE_IN_INBOX } from '../src/triage/types.ts';
import { recordDecision, settleDecision } from '../src/store/decisions.ts';
import { EXAMPLE_KEEP_DAYS } from '../src/store/examples.ts';
import { preferences, setActive } from '../src/store/preferences.ts';
import { addRule, listRules } from '../src/store/rules.ts';
import { FakeMailbox, facts, storeExample, withSampleLabels } from './helpers.ts';
import { type Reply, builtAssets, raw, startDashboard, onePerson, withReason } from './fixtures.ts';
import type { Store } from '../src/store/store.ts';

const ACCOUNT = 'me@example.org';
let db: Sql;
let store: Store;
let calls: string[];

const controls: Controls = {
  models: async () => ({ models: ['p/small', 'p/large'], shortlist: { p: ['p/small', 'p/large'] }, costs: { 'p/small': 0.4 } }),
  modelSignIns: async () => ({ choices: [{ provider: 'openai-codex', label: 'ChatGPT', how: 'device-code' }], signedIn: ['openai-codex'], pending: null }),
  signInChatGPT: async () => (calls.push('chatgpt'), { code: 'ABCD-1234', url: 'https://auth.example/device', expiresAt: 900 }),
  finishChatGPT: async (_db, address) => void calls.push(`finish ${address}`),
  saveModelKey: async (_db, provider, key) => void calls.push(`key ${provider} ${key}`),
  signOutModel: async (_db, provider) => void calls.push(`signout ${provider}`),
  undo: async (_db, id) => {
    calls.push(`undo ${id}`);
    return null;
  },
  inboxEstimate: async (_db, _mailboxes, reach) => (calls.push(`estimate ${reach}`), { messages: 40, model: 30, cost: 0.03 }),
  putBack: async (_db, _account, messageId) => {
    calls.push(`putBack ${messageId}`);
    if (messageId === 'gone') throw new Error('The message no longer exists.');
  },
  startEval: async (_db, { accountId, fewShot, limit }) => {
    calls.push(`eval ${accountId} ${fewShot} ${limit}`);
    return 7;
  },
  proposeLabels: async (_db, { accountId, goal }) => {
    calls.push(`propose ${accountId}`);
    return {
      id: 3,
      goal,
      drafts: [{ name: 'Cold outreach', description: 'Pitches from strangers.', disposition: 'archive', unsubscribe: true, why: 'fewer pitches' }],
      at: 1,
    };
  },
  draftRule: async (_db, { accountId, goal }) => (
    calls.push(`draft ${accountId} ${goal}`),
    { match: { fromDomain: ['example.org'] }, disposition: 'archive', note: 'And another.' }
  ),
  ruleFilter: async (target, ruleId, on) => {
    calls.push(`filter ${ruleId} ${on ? 'on' : 'off'}`);
    await raw(target).run(`UPDATE rules SET filter_id = ?, filter_state = ? WHERE id = ?`, on ? 'f1' : null, on ? 'active' : null, ruleId);
  },
  ruleInbox: async (_db, ruleId) => (
    calls.push(`inbox ${ruleId}`),
    { matches: [{ accountId: ACCOUNT, messageId: 'g1', subject: 'Found', receivedAt: 1, seen: false, reads: true }], capped: false, costEach: 0.001 }
  ),
  applyRule: async (_db, ruleId, ids) => (calls.push(`apply ${ruleId} ${ids.join(',')}`), { deciding: 0, reading: ids.length }),
  revokeGmail: async (_db, email) => (calls.push(`revoke ${email}`), true),
  checkNow: async () => void calls.push('check'),
  activity: async () => ({ running: true, lastPassAt: 5, problems: [], expired: [ACCOUNT] }),
};

beforeEach(async () => {
  ({ store, db } = await onePerson(ACCOUNT));
  calls = [];
});

async function start(options: { withControls?: boolean } = {}) {
  return await startDashboard(people(store), options.withControls === false ? {} : { controls });
}

describe('managing sift from the dashboard', () => {
  it('shows how sift is set up', async () => {
    const { call } = await start();
    const { body } = await call('GET', '/api/manage');
    expect(body).toMatchObject({
      active: false,
      model: { chosen: null, signedIn: ['openai-codex'], pending: null },
      activity: { running: true, expired: [ACCOUNT] },
      accounts: [{ id: ACCOUNT }],
    });
    expect((body['labels'] as Record<string, { id: string; gmailLabel: string; rules: number }[]>)[ACCOUNT]).toContainEqual(
      expect.objectContaining({ id: 'newsletter', gmailLabel: 'sift/newsletters', rules: 0, messages: 0, record: { reviewed: 0, right: 0 } }),
    );
    expect((await call('GET', '/api/models')).body).toEqual({
      models: ['p/small', 'p/large'],
      shortlist: { p: ['p/small', 'p/large'] },
      costs: { 'p/small': 0.4 },
    });
  });

  it("turns sift on and off for the person's own mail, and starts a pass each time", async () => {
    const { call } = await start();
    expect((await call('POST', '/api/active', { active: true })).status).toBe(200);
    expect((await preferences(db)).active).toBe(true);
    expect((await call('GET', '/api/manage')).body).toMatchObject({ active: true });
    // Suggestions says so too, since what its rows mean depends on it.
    expect((await call('GET', '/api/suggestions')).body).toMatchObject({ active: true });
    for (const bad of [{}, { active: 'yes' }, { active: true, interval: 60 }]) expect((await call('POST', '/api/active', bad)).status).toBe(400);
    expect((await call('POST', '/api/active', { active: false })).status).toBe(200);
    expect((await preferences(db)).active).toBe(false);
    expect((await call('GET', '/api/suggestions')).body).toMatchObject({ active: false });
    expect(calls).toEqual(['check', 'check']);
  });

  it("keeps the model and its sign-in the person's own", async () => {
    const { call } = await start();
    expect((await call('POST', '/api/model', { model: 'p/small' })).status).toBe(200);
    expect((await preferences(db)).model).toBe('p/small');
    expect((await call('POST', '/api/model', { model: 'no-slash' })).status).toBe(400);
    expect((await call('POST', '/api/model', { model: null })).status).toBe(200);
    expect((await preferences(db)).model).toBeNull();

    expect((await call('POST', '/api/model/chatgpt', {})).body).toEqual({ code: 'ABCD-1234', url: 'https://auth.example/device', expiresAt: 900 });
    expect((await call('POST', '/api/model/chatgpt/finish', { address: ' http://127.0.0.1:1455/auth/callback?code=c ' })).status).toBe(200);
    expect((await call('POST', '/api/model/key', { provider: 'openai', key: ' sk-test ' })).status).toBe(200);
    expect((await call('POST', '/api/model/key', { provider: 'openai' })).status).toBe(400);
    expect((await call('POST', '/api/model/signout', { provider: 'openai' })).status).toBe(200);
    expect(calls).toEqual(['check', 'check', 'chatgpt', 'finish http://127.0.0.1:1455/auth/callback?code=c', 'key openai sk-test', 'signout openai']);
  });

  it('starts a test run of the model only when asked, through the process that holds the model', async () => {
    const { call } = await start();
    await storeExample(db, ACCOUNT, { id: 'e1', from: 'news@example.com', label: 'newsletter' });
    expect((await call('GET', '/api/evals')).body).toEqual({ runs: [], examples: { [ACCOUNT]: 1 }, defaultLimit: 50, maxLimit: 200 });
    expect(calls).toEqual([]);

    expect((await call('POST', '/api/evals/run', { accountId: ACCOUNT })).body).toEqual({ id: 7 });
    expect((await call('POST', '/api/evals/run', { accountId: ACCOUNT, fewShot: false, limit: 20 })).status).toBe(200);
    expect(calls).toEqual([`eval ${ACCOUNT} true 50`, `eval ${ACCOUNT} false 20`]);
    for (const bad of [{}, { accountId: ACCOUNT, limit: 201 }, { accountId: ACCOUNT, limit: 0 }, { accountId: ACCOUNT, fewShot: 1 }])
      expect((await call('POST', '/api/evals/run', bad)).status).toBe(400);
    // A mailbox that is not the viewer's is not there at all.
    expect((await call('POST', '/api/evals/run', { accountId: 'nobody@example.org' })).status).toBe(404);

    const given = { db, judge: async () => ({ label: 'marketing', reason: 'r' }), model: 'p/small' };
    const id = await startEval(given, { accountId: ACCOUNT, fewShot: false });
    await continueEval(given, id, Infinity);
    const listed = (await call('GET', '/api/evals')).body['runs'] as { id: number; model: string; score: { wrong: number } }[];
    expect(listed).toMatchObject([{ id, model: 'p/small', status: 'done', fewShot: false, score: { total: 1, wrong: 1 } }]);
    const detail = await call('GET', `/api/eval?id=${id}`);
    expect(detail.body).toMatchObject({ run: { id }, results: [{ messageId: 'e1', expected: 'newsletter', got: 'marketing', subject: 'Subject e1' }] });
    expect((await call('GET', '/api/eval?id=99')).status).toBe(404);

    const { call: bare } = await start({ withControls: false });
    expect((await bare('POST', '/api/evals/run', { accountId: ACCOUNT })).status).toBe(409);
  });

  it('asks the model to fill in a rule for one of the person’s mailboxes, and makes nothing', async () => {
    const { call } = await start();
    const drafted = await call('POST', '/api/rules/draft', { accountId: ACCOUNT, goal: '  Archive everything from example.org  ' });
    expect(drafted.body).toEqual({ match: { fromDomain: ['example.org'] }, disposition: 'archive', note: 'And another.' });
    for (const bad of [{ accountId: ACCOUNT }, { accountId: ACCOUNT, goal: '  ' }, { goal: 'x' }])
      expect((await call('POST', '/api/rules/draft', bad)).status).toBe(400);
    expect(calls).toEqual([`draft ${ACCOUNT} Archive everything from example.org`]);
    expect((await call('GET', '/api/rules')).body['rules']).toEqual([]);
  });

  it('asks the model for labels from what the person wants, and makes the ones they keep in every mailbox without any, all or none', async () => {
    const { call } = await start();
    const NEW = 'new@example.org';
    expect((await call('GET', '/api/labels/proposal')).body).toEqual({ proposal: null });
    // Every mailbox has labels: nothing to make them in.
    const pitches = { name: 'Pitches', description: 'From strangers.', disposition: 'archive', unsubscribe: true };
    expect((await call('POST', '/api/labels/accept', { labels: [pitches] })).status).toBe(409);

    await connectAccount(store, NEW, '1', 0, 1);
    // As if added while setting up, before there were labels to give it.
    await raw(db).run(`DELETE FROM labels WHERE account_id = ? AND id <> 'everything_else'`, NEW);
    const proposed = await call('POST', '/api/labels/propose', { goal: '  Fewer sales pitches  ' });
    expect(proposed.body).toMatchObject({ goal: 'Fewer sales pitches', drafts: [{ name: 'Cold outreach', disposition: 'archive', unsubscribe: true }] });
    for (const bad of [{}, { goal: '   ' }, { goal: 'x', accountId: NEW }]) expect((await call('POST', '/api/labels/propose', bad)).status).toBe(400);
    // Recorded on the mailbox that has no labels yet.
    expect(calls).toEqual([`propose ${NEW}`]);

    const before = await listLabels(db, ACCOUNT);
    // One name taken refuses the lot.
    expect((await call('POST', '/api/labels/accept', { labels: [pitches, { ...pitches }] })).status).toBe(409);
    expect(await listLabels(db, NEW)).toHaveLength(1);
    const accepted = await call('POST', '/api/labels/accept', { labels: [pitches, { name: 'Lies', description: 'Scams.', disposition: 'block' }] });
    expect(accepted.body).toEqual({ ids: ['pitches', 'lies'] });
    expect(await listLabels(db, NEW)).toEqual([
      { id: 'pitches', name: 'Pitches', description: 'From strangers.', disposition: 'archive', gmailLabel: 'sift/pitches', unsubscribe: true },
      { id: 'lies', name: 'Lies', description: 'Scams.', disposition: 'spam', gmailLabel: 'sift/lies', block: true },
      expect.objectContaining({ id: 'everything_else' }),
    ]);
    // A mailbox that had labels keeps its own.
    expect(await listLabels(db, ACCOUNT)).toEqual(before);
    // With labels of their own, the mailbox's mail starts coming in.
    expect(calls.at(-1)).toBe('check');
    expect((await call('POST', '/api/labels/accept', { labels: [] })).status).toBe(400);
  });

  it("lists the examples it holds without their content, and deletes one or all of an account's", async () => {
    const { call } = await start();
    await storeExample(db, ACCOUNT, { id: 'e1', from: 'news@example.com', label: 'newsletter', body: 'Private words.', markedAt: 1, name: 'News' });
    await storeExample(db, ACCOUNT, { id: 'e2', from: 'ada@example.org', label: 'personal', markedAt: 2 });
    await storeExample(db, ACCOUNT, { id: 'e3', from: 'bob@example.org', label: 'personal', markedAt: 3 });
    await connectAccount(store, 'other@example.org', '1', 0, 1);
    await withSampleLabels(db, 'other@example.org');
    await storeExample(db, 'other@example.org', { id: 'o1', from: 'cy@example.org', label: 'personal', markedAt: 4 });

    const listed = await call('GET', `/api/examples?account=${encodeURIComponent(ACCOUNT)}`);
    expect(listed.body).toMatchObject({ held: { [ACCOUNT]: 3, 'other@example.org': 1 } });
    expect((listed.body['examples'] as { messageId: string }[]).map((e) => e.messageId)).toEqual(['e3', 'e2', 'e1']);
    expect((listed.body['examples'] as unknown[])[2]).toEqual({
      accountId: ACCOUNT,
      messageId: 'e1',
      fromAddress: 'news@example.com',
      fromName: 'News',
      subject: 'Subject e1',
      labelId: 'newsletter',
      markedAt: 1,
      status: 'captured',
    });
    expect(JSON.stringify(listed.body)).not.toContain('Private words.');

    expect((await call('POST', '/api/examples/delete', { accountId: ACCOUNT, messageId: 'e1' })).body).toEqual({ deleted: 1 });
    expect((await call('POST', '/api/examples/delete', { accountId: ACCOUNT, messageId: 'e1' })).body).toEqual({ deleted: 0 });
    expect((await call('POST', '/api/examples/delete', { accountId: ACCOUNT })).status).toBe(400);
    expect((await call('POST', '/api/examples/delete-all', { accountId: 'nobody@example.org' })).status).toBe(404);
    expect((await call('POST', '/api/examples/delete-all', { accountId: ACCOUNT })).body).toEqual({ deleted: 2 });
    expect(await raw(db).all('SELECT account_id, message_id FROM examples')).toEqual([{ account_id: 'other@example.org', message_id: 'o1' }]);
    // The message row and its decision are sift's record of what it saw and did; only the stored content goes.
    expect(await raw(db).get(`SELECT count(*) AS n FROM messages WHERE id = 'e1'`)).toEqual({ n: 1 });
  });

  it('decides waiting suggestions again when a rule or a label changes, and says how many', async () => {
    const { call } = await start();
    const from = { address: 'sales@example.com', domain: 'example.com' };
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'w1', from }), facts({ accountId: ACCOUNT, messageId: 'w2', from })], '2');
    const marketing = {
      disposition: 'archive',
      subscription: 'unsubscribe',
      stage: 'model',
      confidence: 0.95,
      reason: 'Marketing: a sale',
      labelId: 'marketing',
    } as const;
    await recordDecision(db, ACCOUNT, 'w1', marketing, { now: 10 });
    await recordDecision(db, ACCOUNT, 'w2', marketing, { now: 20 });
    const latest = async (id: string) =>
      await raw(db).get('SELECT stage, disposition, label_id FROM decisions WHERE message_id = ? ORDER BY id DESC LIMIT 1', id);

    const label = await call('POST', '/api/labels', { id: 'marketing', disposition: 'keep' });
    expect(label.body).toEqual({ ok: true, redecided: 2 });
    expect(await latest('w1')).toEqual({ stage: 'model', disposition: 'keep', label_id: 'marketing' });

    const rule = await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: [from.address] }, label: 'newsletter' });
    expect(rule.body).toMatchObject({ redecided: 2 });
    expect(await latest('w2')).toEqual({ stage: 'rules', disposition: 'archive', label_id: 'newsletter' });
    expect(((await call('GET', '/api/suggestions')).body as { waiting: number }).waiting).toBe(0);

    expect((await call('POST', '/api/rules/remove', { id: rule.body['id'] })).body).toEqual({ ok: true, redecided: 2 });
    expect(await latest('w2')).toEqual({ stage: 'model', disposition: 'keep', label_id: 'marketing' });
    expect(((await call('GET', '/api/suggestions?kept=1')).body as { waiting: number }).waiting).toBe(2);

    // A rule on a fact, and Suggestions narrowed by one.
    await raw(db).run(`UPDATE messages SET facts = facts || '{"isReply": true}'::jsonb WHERE id = 'w1'`);
    const replies = async () => ((await call('GET', '/api/suggestions?kept=1&fact=reply')).body as { items: { messageId: string }[] }).items;
    expect((await replies()).map((i) => i.messageId)).toEqual(['w1']);
    expect((await call('GET', '/api/suggestions?fact=nonsense')).status).toBe(400);
    const keepReplies = await call('POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { from: [from.address], facts: { isReply: true } },
      disposition: 'keep',
    });
    expect(keepReplies.body).toMatchObject({ redecided: 1 });
    expect(withReason(await raw(db).get(`SELECT stage, disposition, reason FROM decisions WHERE message_id = 'w1' ORDER BY id DESC LIMIT 1`))).toEqual({
      stage: 'rules',
      disposition: 'keep',
      reason: 'rule: from sales@example.com, is a reply: leave it in the inbox',
    });
    expect(await latest('w2')).toEqual({ stage: 'model', disposition: 'keep', label_id: 'marketing' });
  });

  it('removes a label: its rules and examples go, mail waiting with it is left for the reader, and earlier mail keeps its name', async () => {
    const { call } = await start();
    const from = { address: 'sales@example.com', domain: 'example.com' };
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'w1', from })], '2');
    const marketing = {
      disposition: 'archive',
      subscription: 'preserve',
      stage: 'model',
      confidence: 0.95,
      reason: 'Marketing: a sale',
      labelId: 'marketing',
    } as const;
    await recordDecision(db, ACCOUNT, 'w1', marketing, { now: 10 });
    await storeExample(db, ACCOUNT, { id: 'e1', from: from.address, label: 'marketing' });
    await storeExample(db, ACCOUNT, { id: 'e2', from: from.address, label: 'newsletter' });
    const rule = await addRule(db, ACCOUNT, { match: { from: [from.address] }, whenLabel: 'marketing', disposition: 'spam' }, 'user');
    const kept = await addRule(db, ACCOUNT, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');
    calls = [];

    expect((await call('POST', '/api/labels/remove', { id: 'marketing' })).body).toEqual({ ok: true, redecided: 1 });
    expect(calls).toEqual([`filter ${rule} off`]);
    expect((await listLabels(db, ACCOUNT)).map((l) => l.id)).not.toContain('marketing');
    expect((await listRules(db, ACCOUNT)).map((r) => r.id)).toEqual([kept]);
    expect(await raw(db).all('SELECT message_id FROM examples ORDER BY message_id')).toEqual([{ message_id: 'e2' }]);
    expect(
      withReason(await raw(db).get(`SELECT stage, disposition, label_id, reason FROM decisions WHERE message_id = 'w1' ORDER BY id DESC LIMIT 1`)),
    ).toEqual({
      stage: 'fallback',
      disposition: 'review',
      label_id: null,
      reason: 'the label it was given has been removed',
    });
    // What Sift said of it before still names the label.
    const before = await raw(db).get(`SELECT label_id FROM decisions WHERE message_id = 'w1' ORDER BY id LIMIT 1`);
    expect(before).toEqual({ label_id: 'marketing' });
    expect(await raw(db).get(`SELECT name FROM labels WHERE id = 'marketing' AND account_id = ?`, ACCOUNT)).toEqual({ name: 'Marketing' });

    expect((await call('POST', '/api/labels/remove', { id: 'marketing' })).status).toBe(409);
    expect((await call('POST', '/api/labels/remove', { id: LEAVE_IN_INBOX })).status).toBe(409);
    expect((await call('POST', '/api/labels', { id: 'marketing', name: 'Sales' })).status).toBe(409);

    // A mailbox is never left without a label of its own.
    for (const l of await listLabels(db, ACCOUNT))
      if (l.id !== LEAVE_IN_INBOX && l.id !== 'newsletter') expect((await call('POST', '/api/labels/remove', { id: l.id })).status, l.id).toBe(200);
    const last = await call('POST', '/api/labels/remove', { id: 'newsletter' });
    expect(last.status).toBe(409);
    expect(last.body['error']).toContain('Newsletters is the last of your labels');

    // The name again brings it back, as the label it is now.
    const again = await call('POST', '/api/labels/add', { labels: [{ name: 'Marketing', description: 'Sales pitches.', disposition: 'keep' }] });
    expect(again.body).toEqual({ ids: ['marketing'] });
    expect((await listLabels(db, ACCOUNT)).find((l) => l.id === 'marketing')).toMatchObject({ description: 'Sales pitches.', disposition: 'keep' });
  });

  it('changes nothing of Leave in inbox', async () => {
    const { call } = await start();
    expect((await call('POST', '/api/labels', { id: LEAVE_IN_INBOX, description: 'Bills I still owe' })).status).toBe(409);
    expect((await listLabels(db, ACCOUNT)).find((l) => l.id === LEAVE_IN_INBOX)?.description).toBe('');
  });

  it('edits labels and rules', async () => {
    const { call } = await start();

    expect((await call('POST', '/api/labels', { id: 'newsletter', disposition: 'keep', name: 'Reading' })).status).toBe(200);
    expect((await listLabels(db, ACCOUNT)).find((l) => l.id === 'newsletter')).toMatchObject({
      disposition: 'keep',
      name: 'Reading',
      gmailLabel: 'sift/newsletters',
    });
    expect((await call('POST', '/api/labels', { id: 'nonsense', disposition: 'keep' })).status).toBe(409);
    expect((await call('POST', '/api/labels', { id: 'newsletter', disposition: 'delete' })).status).toBe(400);

    const mine = await call('POST', '/api/labels/add', {
      labels: [{ name: 'Investor updates', description: 'Updates from companies I invested in.', disposition: 'keep' }],
    });
    expect(mine.body).toEqual({ ids: ['investor-updates'] });
    expect((await listLabels(db, ACCOUNT)).at(-2)).toEqual({
      id: 'investor-updates',
      name: 'Investor updates',
      description: 'Updates from companies I invested in.',
      disposition: 'keep',
      gmailLabel: 'sift/investor-updates',
    });
    for (const taken of ['investor updates', 'Review', 'Did', 'Cold outreach', '!!!'])
      expect((await call('POST', '/api/labels/add', { labels: [{ name: taken, description: '', disposition: 'keep' }] })).status).toBe(409);
    // Up to the limit, and no further.
    // Leave in inbox is not one the limit counts.
    const own = async () => (await listLabels(db, ACCOUNT)).filter((l) => l.id !== LEAVE_IN_INBOX).length;
    for (let n = await own(); n < MAX_LABELS; n++)
      expect((await call('POST', '/api/labels/add', { labels: [{ name: `Extra ${n}`, description: '', disposition: 'keep' }] })).status).toBe(200);
    const full = await call('POST', '/api/labels/add', { labels: [{ name: 'One too many', description: '', disposition: 'keep' }] });
    expect(full.status).toBe(409);
    expect(await own()).toBe(MAX_LABELS);

    const added = await call('POST', '/api/rules', {
      accountId: ACCOUNT,
      // Blank and repeated values are dropped, and a condition left with none.
      match: { fromDomain: ['example.com', ' example.net ', 'EXAMPLE.com', ''], subjectContains: [''] },
      label: 'investor-updates',
    });
    const excepted = await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: ['a@example.com'] }, label: 'marketing', disposition: 'keep' });
    expect(await listRules(db, ACCOUNT)).toMatchObject([
      { id: added.body['id'], match: { fromDomain: ['example.com', 'example.net'] }, labelId: 'investor-updates', source: 'user' },
      { id: excepted.body['id'], labelId: 'marketing', disposition: 'keep' },
    ]);
    expect((await listRules(db, ACCOUNT))[0]).not.toHaveProperty('disposition');
    expect((await call('GET', '/api/rules')).body['rules']).toMatchObject([
      { labelName: 'Investor updates', override: null, disposition: 'keep' },
      { labelName: 'Marketing', override: 'keep', disposition: 'keep' },
    ]);
    // A name is said in place of the conditions; adding the same conditions again with none takes it away.
    const again = { accountId: ACCOUNT, match: { fromDomain: ['example.net', 'example.com'] }, label: 'investor-updates' };
    expect((await call('POST', '/api/rules', { ...again, name: ' Investor  mail ' })).body).toMatchObject({ id: added.body['id'], replaced: true });
    expect((await call('GET', '/api/rules')).body['rules']).toMatchObject([{ id: added.body['id'], name: 'Investor mail' }, { name: null }]);
    await call('POST', '/api/rules', { ...again, name: '' });
    expect((await listRules(db, ACCOUNT))[0]).not.toHaveProperty('name');
    expect((await call('POST', '/api/rules', { accountId: ACCOUNT, match: {}, label: 'marketing' })).status).toBe(400);
    expect((await call('POST', '/api/rules', { accountId: ACCOUNT, match: { fromName: ['Dependabot'] }, label: 'marketing' })).status).toBe(400);
    const named = await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: ['a@example.com'], fromNameContains: ['bot'] }, label: 'marketing' });
    expect((await call('GET', '/api/rules')).body['rules']).toContainEqual(
      expect.objectContaining({ id: named.body['id'], match: { from: ['a@example.com'], fromNameContains: ['bot'] } }),
    );
    await call('POST', '/api/rules/remove', { id: named.body['id'] });
    const onFacts = await call('POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { fromDomain: ['example.org'], facts: { isReply: false, unsubscribe: ['header', 'none'], category: 'promotions' } },
      disposition: 'archive',
    });
    expect(onFacts.status).toBe(200);
    expect((await listRules(db, ACCOUNT)).find((r) => r.id === onFacts.body['id'])).toMatchObject({
      match: { fromDomain: ['example.org'], facts: { isReply: false, unsubscribe: ['header', 'none'], category: 'promotions' } },
    });
    for (const facts of [
      {},
      { isReply: 'yes' },
      { dmarc: 'fail' },
      { trackingPixel: false },
      { category: 'spam' },
      { spf: 'pass' },
      { unsubscribe: ['one-click', 'header'] },
      { listId: 'news.example.com' },
    ])
      expect((await call('POST', '/api/rules', { accountId: ACCOUNT, match: { facts }, disposition: 'archive' })).status, JSON.stringify(facts)).toBe(400);
    expect((await call('POST', '/api/rules', { accountId: ACCOUNT, match: { body: 'x' }, label: 'marketing' })).status).toBe(400);
    expect((await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: ['a@example.com'] }, label: 'no-such-label' })).status).toBe(409);
    expect(
      (await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: ['a@example.com'] }, label: 'marketing', disposition: 'review' })).status,
    ).toBe(400);
    // With no filter recorded, Gmail is still asked: one sift wrote and lost track of goes with the rule.
    expect((await call('POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(200);
    expect(calls).toContain(`filter ${String(added.body['id'])} off`);
    expect((await call('POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(409);
  });

  it('makes and changes a label in every mailbox of the person, all or none', async () => {
    const { call } = await start();
    const OTHER = 'other@example.org';
    await connectAccount(store, OTHER, '1', 0, 1);
    await withSampleLabels(db, OTHER);
    expect((await call('POST', '/api/labels/add', { labels: [{ name: 'Travel', description: 'Bookings.', disposition: 'keep' }] })).body).toEqual({
      ids: ['travel'],
    });
    for (const account of [ACCOUNT, OTHER]) expect((await listLabels(db, account)).map((l) => l.id)).toContain('travel');
    expect((await call('POST', '/api/labels', { id: 'travel', disposition: 'archive', name: 'Trips' })).status).toBe(200);
    for (const account of [ACCOUNT, OTHER])
      expect((await listLabels(db, account)).find((l) => l.id === 'travel')).toMatchObject({ name: 'Trips', disposition: 'archive' });
    // A name one mailbox already has refuses the lot.
    await call('POST', '/api/labels', { id: 'newsletter', name: 'Reading' });
    expect(
      (
        await call('POST', '/api/labels/add', {
          labels: [
            { name: 'Shopping', description: '', disposition: 'keep' },
            { name: 'Reading', description: '', disposition: 'keep' },
          ],
        })
      ).status,
    ).toBe(409);
    for (const account of [ACCOUNT, OTHER]) expect((await listLabels(db, account)).map((l) => l.id)).not.toContain('shopping');
  });

  it('sets what a label does, including blocking and marking read', async () => {
    const { call } = await start();
    const does = async () => (await listLabels(db, ACCOUNT)).find((l) => l.id === 'marketing');
    expect((await call('POST', '/api/labels', { id: 'marketing', disposition: 'block' })).status).toBe(200);
    expect(await does()).toMatchObject({ disposition: 'spam', block: true });
    expect((await call('POST', '/api/labels', { id: 'marketing', disposition: 'archive', markRead: true })).status).toBe(200);
    expect(await does()).toMatchObject({ disposition: 'archive', markRead: true });
    expect(await does()).not.toHaveProperty('block');
    const shown = ((await call('GET', '/api/manage')).body['labels'] as Record<string, { id: string; disposition: string; markRead: boolean }[]>)[ACCOUNT];
    expect(shown?.find((l) => l.id === 'marketing')).toMatchObject({ disposition: 'archive', markRead: true });
    expect(shown?.find((l) => l.id === 'phishing')).toMatchObject({ disposition: 'spam', markRead: false });
    expect((await call('POST', '/api/labels', { id: 'personal', unsubscribe: true })).status).toBe(200);
    expect((await listLabels(db, ACCOUNT)).find((l) => l.id === 'personal')).toMatchObject({ disposition: 'keep', unsubscribe: true });
    expect((await call('POST', '/api/labels', { id: 'personal', unsubscribe: 'yes' })).status).toBe(400);
    const extra = await call('POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { from: ['x@example.com'] },
      label: 'security',
      unsubscribe: true,
      markRead: true,
    });
    expect((await listRules(db, ACCOUNT)).find((r) => r.id === extra.body['id'])).toMatchObject({ subscription: 'unsubscribe', markRead: true });
    // "Leave it for me" is no longer something a label can be set to do.
    expect((await call('POST', '/api/labels', { id: 'marketing', disposition: 'review' })).status).toBe(400);
    expect((await call('POST', '/api/labels', { id: 'marketing', markRead: 'yes' })).status).toBe(400);
    expect((await call('POST', '/api/labels/add', { labels: [{ name: 'Scams', description: '', disposition: 'block' }] })).body).toEqual({
      ids: ['scams'],
    });
    expect((await listLabels(db, ACCOUNT)).at(-2)).toMatchObject({ id: 'scams', disposition: 'spam', block: true });
  });

  it('puts a corrected message right in Gmail, and still saves the answer if it cannot', async () => {
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'done' }), facts({ accountId: ACCOUNT, messageId: 'gone' })], '2');
    for (const id of ['done', 'gone'])
      await recordDecision(
        db,
        ACCOUNT,
        id,
        { disposition: 'archive', subscription: 'preserve', stage: 'model', reason: 'r', labelId: 'marketing' },
        { carryOut: true },
      );
    const { call } = await start();
    const answer = { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal' };
    expect((await call('POST', '/api/feedback', { ...answer, messageId: 'done' })).body).toEqual({ notFixed: null });
    const failed = await call('POST', '/api/feedback', { ...answer, messageId: 'gone' });
    expect(failed.status).toBe(200);
    // Gmail's own words stay in the log: only a refusal is written for the page.
    expect(failed.body).toEqual({ notFixed: 'Sift could not do that. Why is in its log.' });
    expect(await raw(db).get('SELECT count(*) AS n FROM feedback')).toEqual({ n: 2 });
    expect(calls).toEqual(['putBack done', 'putBack gone']);
  });

  it('keeps mail Sift marked for review while on waiting, and takes the mark back when it is answered', async () => {
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'asked' }), facts({ accountId: ACCOUNT, messageId: 'acted' })], '2');
    await recordDecision(
      db,
      ACCOUNT,
      'asked',
      { disposition: 'review', subscription: 'preserve', stage: 'model', reason: 'could be either' },
      { carryOut: true },
    );
    await recordDecision(
      db,
      ACCOUNT,
      'acted',
      { disposition: 'archive', subscription: 'preserve', stage: 'model', reason: 'r', labelId: 'marketing' },
      { carryOut: true },
    );
    const { call } = await start();
    expect((await call('GET', '/api/suggestions')).body).toMatchObject({ waiting: 1, items: [{ messageId: 'asked' }] });
    // A rule or a label changing does not answer it for the user.
    expect(await redecideWaiting(db, ACCOUNT)).toBe(0);

    const reply = await call('POST', '/api/feedback', { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', messageId: 'asked' });
    expect(reply.body).toEqual({ notFixed: null });
    expect(calls).toEqual(['putBack asked']);
    expect(await raw(db).get("SELECT disposition, label_id, carry_out, by_user FROM decisions WHERE message_id = 'asked' ORDER BY id DESC LIMIT 1")).toEqual({
      disposition: 'keep',
      label_id: 'personal',
      carry_out: true,
      by_user: true,
    });
    expect((await call('GET', '/api/suggestions')).body).toMatchObject({ waiting: 0 });
  });

  it('asks the running sift to undo and check now', async () => {
    const { call } = await start();
    await raw(db).run(
      `INSERT INTO actions (id, account_id, type, payload, original_labels, status, created_at) VALUES (3, ?, 'archive', '{}', '[]', 'done', 1)`,
      ACCOUNT,
    );
    expect((await call('POST', '/api/undo', { id: 3 })).body).toEqual({ message: null });
    // A change that is not in this person's database is not passed on.
    expect(await call('POST', '/api/undo', { id: 404 })).toMatchObject({ status: 409, body: { error: 'There is no change #404.' } });
    expect((await call('POST', '/api/check', {})).status).toBe(200);
    expect(calls).toEqual(['undo 3', 'check']);
  });

  it('refuses every write that did not come from its own page', async () => {
    const { call } = await start();
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
    expect(calls).toEqual([]);
  });

  it("lists what a rule decided and has not moved, and passes the inbox and the press on for the rule's mailbox", async () => {
    const { call } = await start();
    const id = await addRule(db, ACCOUNT, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'w1', subject: 'Waiting' }), facts({ accountId: ACCOUNT, messageId: 'w2' })], '2');
    const byRule = { disposition: 'archive', subscription: 'preserve', stage: 'rules', labelId: 'newsletter', ruleId: id, reason: 'rule' } as const;
    await recordDecision(db, ACCOUNT, 'w1', byRule, { now: 5 });
    await recordDecision(db, ACCOUNT, 'w2', byRule, { now: 5, carryOut: true });
    expect((await call('GET', `/api/rules/waiting?id=${id}`)).body).toEqual({
      total: 1,
      messages: [{ accountId: ACCOUNT, messageId: 'w1', subject: 'Waiting', receivedAt: 0 }],
    });
    expect((await call('GET', `/api/rules/inbox?id=${id}`)).body).toMatchObject({ matches: [{ messageId: 'g1', reads: true }], costEach: 0.001 });
    expect((await call('GET', '/api/rules/inbox?id=r-nobody')).status).toBe(404);
    expect((await call('POST', '/api/rules/apply', { id, messageIds: ['g1'] })).body).toEqual({ deciding: 0, reading: 1 });
    expect((await call('POST', '/api/rules/apply', { id, messageIds: [] })).status).toBe(400);
    expect(calls).toEqual([`inbox ${id}`, `apply ${id} g1`]);
  });

  it('charts what a rule decided by itself over 30 days, carried out or not, and what the model calls behind it cost', async () => {
    const { call } = await start();
    const id = await addRule(db, ACCOUNT, { match: { from: ['news@example.com'] }, labelId: 'newsletter', when: 'only the digests' }, 'user');
    await recordSync(
      db,
      ACCOUNT,
      ['u1', 'u2', 'u3', 'u4'].map((messageId) => facts({ accountId: ACCOUNT, messageId })),
      '2',
    );
    const byRule = { disposition: 'archive', subscription: 'preserve', stage: 'model', labelId: 'newsletter', ruleId: id, reason: 'rule' } as const;
    const now = Date.now();
    const usage = { model: 'test-model', inputTokens: 10, outputTokens: 1, costUsd: 0.004 };
    const run = await startRun(db, { accountId: ACCOUNT, messageId: 'u1', model: 'test-model', ruleId: id, now });
    await finishRun(db, run, { usage, now });
    // A check that found the condition unmet decided nothing for the rule, and still cost.
    await finishRun(db, await startRun(db, { accountId: ACCOUNT, messageId: 'u3', model: 'test-model', ruleId: id, now }), { usage, now });
    await settleDecision(db, await recordDecision(db, ACCOUNT, 'u1', byRule, { now, carryOut: true, runId: run }), 'done');
    await recordDecision(db, ACCOUNT, 'u2', byRule, { now });
    // Older than the chart, and the user's own answer: neither counts.
    await recordDecision(db, ACCOUNT, 'u3', byRule, { now: now - 40 * 86_400_000 });
    await recordDecision(db, ACCOUNT, 'u4', byRule, { now, byUser: true });
    const { daily } = (await call('GET', `/api/rules/usage?id=${id}`)).body as { daily: { changed: number; left: number; costUsd: number }[] };
    expect(daily).toHaveLength(30);
    expect(daily.at(-1)).toMatchObject({ changed: 1, left: 1, costUsd: 0.008 });
    expect(daily.slice(0, -1).every((day) => day.changed + day.left + day.costUsd === 0)).toBe(true);
  });

  it('writes a rule to Gmail as a filter only while sift is on, and removes the filter with the rule', async () => {
    const { call } = await start();
    const id = await addRule(db, ACCOUNT, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');
    const spam = await addRule(db, ACCOUNT, { match: { from: ['scam@example.com'] }, labelId: 'phishing' }, 'user');
    const listed = (await call('GET', '/api/rules')).body['rules'] as { id: string; filter: Record<string, unknown> }[];
    expect(listed.find((r) => r.id === id)?.filter).toMatchObject({ state: 'none', possible: true, reason: null });
    expect(listed.find((r) => r.id === spam)?.filter).toMatchObject({ state: 'none', possible: false, reason: 'Gmail filters cannot mark mail as spam.' });

    const off = await call('POST', '/api/rules/filter', { id, on: true });
    expect(off.status).toBe(409);
    expect(off.body['error']).toMatch(/Sift is off/);
    expect(calls).toEqual([]);

    await setActive(db, true);
    const written = await call('POST', '/api/rules/filter', { id, on: true });
    expect(written.body).toMatchObject({ filterId: 'f1', filter: { state: 'active', possible: true } });
    expect((await call('POST', '/api/rules/filter', { id })).status).toBe(400);
    expect((await call('POST', '/api/rules/filter', { id: 7, on: true })).status).toBe(400);

    // Taking the filter out does not need sift to be on.
    await setActive(db, false);
    expect((await call('POST', '/api/rules/remove', { id })).status).toBe(200);
    expect(calls).toEqual([`filter ${id} on`, `filter ${id} off`]);
    expect((await listRules(db, ACCOUNT)).map((r) => r.id)).toEqual([spam]);
  });

  it('offers a new rule as a Gmail filter only when it can be one and Sift is on', async () => {
    const { call } = await start();
    const add = async (rule: Record<string, unknown>) => (await call('POST', '/api/rules', { accountId: ACCOUNT, ...rule })).body['filter'];
    expect(await add({ match: { from: ['news@example.com'] }, label: 'newsletter' })).toBeNull();
    await setActive(db, true);
    expect(await add({ match: { from: ['digest@example.com'] }, label: 'newsletter' })).toMatchObject({
      possible: true,
      plan: { criteria: { from: 'digest@example.com' }, gmailLabel: 'sift/newsletters', archive: true },
    });
    expect(await add({ match: { from: ['scam@example.com'] }, label: 'phishing' })).toBeNull();
    expect(await add({ match: { from: ['shop@example.com'] }, label: 'marketing', when: 'it is a sale' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('takes a standing back with its Gmail filter, as removing the rule does', async () => {
    const { call } = await start();
    const id = await addRule(db, ACCOUNT, { match: { from: ['news@example.com'] }, disposition: 'archive' }, 'user');
    await setActive(db, true);
    expect((await call('POST', '/api/rules/filter', { id, on: true })).status).toBe(200);
    expect((await call('POST', '/api/standing/clear', { accountId: ACCOUNT, address: 'news@example.com' })).status).toBe(200);
    expect(calls).toEqual([`filter ${id} on`, `filter ${id} off`]);
    expect(await listRules(db, ACCOUNT)).toEqual([]);
  });

  it('can only look, not manage, when no controls are given', async () => {
    const { call } = await start({ withControls: false });
    expect((await call('POST', '/api/undo', { id: 1 })).status).toBe(409);
    expect((await call('GET', '/api/manage')).body).toMatchObject({ activity: { running: false } });
  });
});

describe('signing in with Google', () => {
  const SECRET = 'session-secret';
  let completed: string[];
  let logged: string[];
  let hasClient: boolean;
  const signIn: SignIn = {
    hasClient: () => hasClient,
    url: (redirectUri, state, challenge) => `https://accounts.example/auth?redirect=${encodeURIComponent(redirectUri)}&state=${state}&challenge=${challenge}`,
    complete: async (redirectUri, code, _verifier, addTo) => {
      completed.push(`${redirectUri} ${code} addTo=${addTo}`);
      if (code === 'refused') throw new Error('invalid_grant');
      if (code === 'second') {
        await connectAccount(store, 'work@example.com', '1', 0, 1);
        return 'work@example.com';
      }
      // Already someone else's: connecting it again leaves it theirs.
      if (code === 'taken') {
        await connectAccount(store, 'bravo@example.net', '1', 0);
        return 'bravo@example.net';
      }
      return ACCOUNT;
    },
  };

  async function startWithSignIn() {
    return await startDashboard(people(store), {
      assetsDir: builtAssets({ 'assets/app.js': '1', 'sw.js': '1', 'manifest.webmanifest': '{}' }),
      controls,
      signIn,
      sessionSecret: SECRET,
      signInAddresses: ['http://localhost:1', 'https://box.example.ts.net'],
      allowedHosts: ['box.example.ts.net', 'homebox'],
      log: (line) => logged.push(line),
      now: () => 1000,
    });
  }
  const cookieFrom = (headers: Record<string, string | string[] | undefined>) => String(headers['set-cookie']).split(';')[0] ?? '';
  const stateFrom = (headers: Record<string, string | string[] | undefined>) => new URL(String(headers['location'])).searchParams.get('state') ?? '';
  /** Google's return to the browser that started `login`, which holds its sign-in cookie. */
  const callback = (call: Awaited<ReturnType<typeof startDashboard>>['call'], login: Reply, code: string, headers: Record<string, string> = {}) =>
    call('GET', `/auth/callback?state=${stateFrom(login.headers)}&code=${code}`, undefined, {
      ...headers,
      cookie: [headers['cookie'], cookieFrom(login.headers)].filter(Boolean).join('; '),
    });

  beforeEach(() => {
    completed = [];
    logged = [];
    hasClient = true;
  });

  it('serves the page to anyone but the data only to someone signed in', async () => {
    const { call } = await startWithSignIn();
    expect((await call('GET', '/')).status).toBe(200);
    expect((await call('GET', '/assets/app.js')).status).toBe(200);
    // What installs the page as an app holds no data, and a browser fetches the manifest without cookies.
    for (const path of ['/sw.js', '/manifest.webmanifest', '/rules', '/system']) expect((await call('GET', path)).status).toBe(200);
    for (const path of ['/api/summary', '/api/manage', '/api/suggestions', '/api/senders']) expect((await call('GET', path)).status).toBe(401);
    expect((await call('POST', '/api/active', { active: true })).status).toBe(401);
    expect((await call('GET', '/api/summary', undefined, { cookie: 'sift_session=forged.signature' })).status).toBe(401);
    expect((await call('GET', '/api/session')).body).toMatchObject({ required: true, email: null, canSignIn: true, reason: null });
    expect((await preferences(db)).active).toBe(false);
  });

  it('signs in through Google and returns to the address the browser used', async () => {
    const { call, port } = await startWithSignIn();
    const login = await call('GET', '/auth/login');
    expect(login.status).toBe(303);
    expect(String(login.headers['location'])).toContain(encodeURIComponent(`http://localhost:${port}/auth/callback`));

    const back = await callback(call, login, 'abc');
    expect(back.status).toBe(303);
    expect(back.headers['location']).toBe('/');
    const [session, started] = back.headers['set-cookie'] as string[];
    expect(session).toMatch(/^sift_session=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    expect(started).toBe('sift_signin=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax');
    expect(completed).toEqual([`http://localhost:${port}/auth/callback abc addTo=null`]);

    const cookie = { cookie: cookieFrom(back.headers) };
    expect((await call('GET', '/api/session', undefined, cookie)).body).toMatchObject({ email: ACCOUNT });
    expect((await call('GET', '/api/manage', undefined, cookie)).status).toBe(200);
    expect((await call('POST', '/api/active', { active: true }, cookie)).status).toBe(200);

    // The same state cannot be used twice, and an unknown one is refused.
    expect(String((await callback(call, login, 'abc')).headers['location'])).toContain('expired');
    expect(completed).toHaveLength(1);
  });

  it('uses HTTPS for the return address and the cookie behind Tailscale serve', async () => {
    const { call } = await startWithSignIn();
    const proxied = { host: 'box.example.ts.net', 'x-forwarded-proto': 'https' };
    const login = await call('GET', '/auth/login', undefined, proxied);
    expect(String(login.headers['location'])).toContain(encodeURIComponent('https://box.example.ts.net/auth/callback'));
    const back = await callback(call, login, 'abc', proxied);
    expect(String(back.headers['set-cookie'])).toMatch(/; Secure$/);
  });

  it('explains why sign-in is not possible at a plain address or without a client', async () => {
    const { call, port } = await startWithSignIn();
    const plain = await call('GET', '/api/session', undefined, { host: `homebox:${port}` });
    expect(plain.body).toMatchObject({ canSignIn: false, reason: 'address', addresses: ['http://localhost:1', 'https://box.example.ts.net'] });
    expect((await call('GET', '/auth/login', undefined, { host: `homebox:${port}` })).headers['location']).toBe('/');

    hasClient = false;
    expect((await call('GET', '/api/session')).body).toMatchObject({ canSignIn: false, reason: 'no-client' });
  });

  it('says a sign-in failed and logs why, and adds a second account only for someone signed in', async () => {
    const { call } = await startWithSignIn();
    const login = await call('GET', '/auth/login?add=1');
    const refused = await callback(call, login, 'refused');
    expect(decodeURIComponent(String(refused.headers['location']))).toBe('/?signin=Google did not complete the sign-in.');
    expect(logged).toEqual(['GET /auth/callback: invalid_grant']);
    expect(String(refused.headers['set-cookie'])).not.toContain('sift_session');
    expect(completed.at(-1)).toContain('addTo=null');

    const first = await call('GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await callback(call, first, 'abc')).headers) };
    const add = await call('GET', '/auth/login?add=1', undefined, cookie);
    const added = await callback(call, add, 'second', cookie);
    // The account being added joins the mailboxes of whoever is signed in, who stays signed in as themselves.
    expect(completed.at(-1)).toContain(`addTo=${ACCOUNT}`);
    expect(added.headers['location']).toBe('/?settings=1');
    expect(String(added.headers['set-cookie'])).not.toContain('sift_session');
    expect((await call('GET', '/api/session', undefined, cookie)).body).toMatchObject({ email: ACCOUNT });

    // Someone else's is refused, rather than signing in as them; said in Settings, as is any failure while signed in.
    const taken = await callback(call, await call('GET', '/auth/login?add=1', undefined, cookie), 'taken', cookie);
    expect(decodeURIComponent(String(taken.headers['location']))).toBe('/?settings=1&signin=bravo@example.net is already connected to Sift by someone else.');
    expect(String(taken.headers['set-cookie'])).not.toContain('sift_session');
    const asked = await call('GET', '/auth/login?add=1', undefined, cookie);
    const denied = await call('GET', `/auth/callback?state=${stateFrom(asked.headers)}&error=access_denied`, undefined, {
      cookie: `${cookie.cookie}; ${cookieFrom(asked.headers)}`,
    });
    expect(denied.headers['location']).toBe('/?settings=1&signin=Google%20did%20not%20grant%20access.');
  });

  it('completes a sign-in only in the browser that started it', async () => {
    const { call } = await startWithSignIn();
    const login = await call('GET', '/auth/login');
    // The consent link, followed in another browser: Google returns there with the state but no cookie.
    const elsewhere = await call('GET', `/auth/callback?state=${stateFrom(login.headers)}&code=abc`);
    expect(String(elsewhere.headers['location'])).toContain('another%20browser');
    expect(String(elsewhere.headers['set-cookie'])).not.toContain('sift_session=s');
    expect(completed).toEqual([]);
  });

  it('adds a mailbox only to the person still signed in where it was started', async () => {
    const { call } = await startWithSignIn();
    const first = await call('GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await callback(call, first, 'abc')).headers) };
    const add = await call('GET', '/auth/login?add=1', undefined, cookie);
    // Signed out before Google came back: the mailbox would join someone no longer here.
    const back = await callback(call, add, 'second');
    expect(String(back.headers['location'])).toContain('Sign%20in%20again');
    expect(completed).toHaveLength(1);
  });

  it('ends a session on sign-out, when it expires, and when its account is removed', async () => {
    const { call } = await startWithSignIn();
    const login = await call('GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await callback(call, login, 'abc')).headers) };
    const out = await call('POST', '/api/signout', {}, cookie);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');

    await raw(store.central).run('DELETE FROM accounts');
    expect((await call('GET', '/api/summary', undefined, cookie)).status).toBe(401);
  });

  it('does not believe a forwarded scheme from another machine', async () => {
    // Every test request comes from this machine, so this checks the header alone is not enough to be
    // offered sign-in at a name that is not localhost.
    const { call, port, handle } = await startWithSignIn();
    expect((await call('GET', '/api/session', undefined, { host: `homebox:${port}`, 'x-forwarded-proto': 'http' })).body).toMatchObject({
      canSignIn: false,
    });
    // The handler takes the scheme from the URL, which its host builds; a forwarded header alone does nothing.
    const offered = async (url: string) =>
      ((await (await handle(new Request(url, { headers: { host: 'homebox', 'x-forwarded-proto': 'https' } }))).json()) as { canSignIn: boolean }).canSignIn;
    expect(await offered('https://homebox/api/session')).toBe(true);
    expect(await offered('http://homebox/api/session')).toBe(false);
  });
});

describe('going through the inbox', () => {
  const gmailMessage = (id: string, from = 'news@example.com', labelIds = ['INBOX']): RawMessage => ({
    id,
    threadId: `t${id}`,
    labelIds,
    internalDate: 5,
    headers: [
      { name: 'From', value: from },
      { name: 'Subject', value: id },
    ],
  });
  const unsure = async () => ({ label: 'unsure', reason: 'cannot tell', confidence: 0.2 });
  let mailbox: FakeMailbox;
  let asked: string[];
  let listed: string[];
  let gmail: Record<string, RawMessage>;
  beforeEach(() => {
    mailbox = new FakeMailbox();
    asked = [];
    listed = [];
    gmail = {};
  });
  /** Gmail holding `ids` in the inbox, listed two to a page. */
  const inGmail = (...messages: RawMessage[]) => {
    for (const m of messages) {
      gmail[m.id] = m;
      mailbox.labels.set(m.id, [...m.labelIds]);
    }
  };
  const api = {
    searchInbox: async (_query: string, pageToken?: string) => {
      const ids = Object.keys(gmail);
      const from = Number(pageToken ?? 0);
      listed.push(pageToken ?? '');
      return { ids: ids.slice(from, from + 2), ...(from + 2 < ids.length ? { nextPageToken: String(from + 2) } : {}) };
    },
    getMetadata: async (id: string) => gmail[id] ?? null,
  };
  /** One piece of work on the run, with Sift on or off; the model is `judge`. */
  const goOn = async (run: number, options: { on?: boolean; judge?: typeof unsure; until?: number; now?: () => number } = {}) =>
    await continueInboxRun(
      {
        db,
        api,
        mailbox: options.on ? mailbox : null,
        answers: mailbox,
        sources: { api: { getContent: async () => null, getThread: async () => null }, mailbox },
        model: {
          model: 'test/model',
          judge: async (input) => (asked.push(input.evidence.facts.messageId), await (options.judge ?? unsure)()),
        },
        ...(options.until === undefined ? {} : { until: options.until }),
        now: options.now ?? (() => 100),
      },
      (await listAccounts(db))[0]!,
      run,
    );
  const begin = async (acts: boolean, { most = 10, at = 50 } = {}) => {
    await startInboxRuns(db, [ACCOUNT], { acts, most, now: at });
    return (await goingInboxRuns(db))[0]!.id;
  };

  it('lists the inbox and decides what Sift never saw, without moving the sync cursor', async () => {
    inGmail(gmailMessage('a'), gmailMessage('b'), gmailMessage('c'));
    gmail['gone'] = gmailMessage('gone', 'news@example.com', ['SENT']);
    const run = await begin(false);
    expect(await goOn(run)).toMatchObject({ from: 0, to: 4, of: 4 });
    expect(listed).toEqual(['', '2']);
    expect(asked.toSorted()).toEqual(['a', 'b', 'c']);
    expect((await listAccounts(db))[0]?.historyId).toBe('1');
    // Recorded to suggest about only, so a pass that came to them first would not act either.
    expect(await raw(db).all('SELECT id, suggest_only FROM messages ORDER BY id')).toEqual([
      { id: 'a', suggest_only: true },
      { id: 'b', suggest_only: true },
      { id: 'c', suggest_only: true },
    ]);
    expect(await raw(db).all('SELECT finished_at FROM inbox_runs')).toEqual([{ finished_at: 100 }]);
  });

  it('goes no further than its most, newest first', async () => {
    inGmail(gmailMessage('a'), gmailMessage('b'), gmailMessage('c'));
    const run = await begin(false, { most: 2 });
    expect(await goOn(run)).toMatchObject({ to: 2, of: 2 });
    expect(listed).toEqual(['']);
    expect(asked.toSorted()).toEqual(['a', 'b']);
  });

  it('decides again what waits on the user, but not what they answered or what was decided since it began', async () => {
    inGmail(gmailMessage('waiting'), gmailMessage('answered'), gmailMessage('since'));
    await recordSync(
      db,
      ACCOUNT,
      ['waiting', 'answered', 'since'].map((messageId) => facts({ accountId: ACCOUNT, messageId })),
      '2',
    );
    const said = { disposition: 'review', subscription: 'preserve', stage: 'model', reason: 'unsure' } as const;
    await recordDecision(db, ACCOUNT, 'waiting', said, { carryOut: false, now: 10 });
    await recordDecision(db, ACCOUNT, 'answered', said, { carryOut: false, byUser: true, now: 10 });
    await recordDecision(db, ACCOUNT, 'since', said, { carryOut: false, now: 60 });
    await goOn(await begin(false));
    expect(asked).toEqual(['waiting']);
    expect(await raw(db).all("SELECT count(*) AS n FROM decisions WHERE message_id = 'waiting'")).toEqual([{ n: 2 }]);
  });

  it('carries out what it decides only when Sift was on at the press and still is', async () => {
    await addRule(db, ACCOUNT, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');
    inGmail(gmailMessage('a'), gmailMessage('b'), gmailMessage('c'));
    // Off at the press: a suggestion, even with Sift turned on since.
    await goOn(await begin(false), { on: true });
    expect(mailbox.modifyCalls).toBe(0);
    // On at the press, and still on.
    await goOn(await begin(true, { at: 150 }), { on: true, now: () => 200 });
    expect(await raw(db).all('SELECT message_id, carry_out, outcome FROM decisions WHERE decided_at = 200 ORDER BY message_id')).toEqual([
      { message_id: 'a', carry_out: true, outcome: 'done' },
      { message_id: 'b', carry_out: true, outcome: 'done' },
      { message_id: 'c', carry_out: true, outcome: 'done' },
    ]);
    expect(mailbox.labels.get('a')).not.toContain('INBOX');
  });

  it('takes back what Sift did before carrying out something different', async () => {
    inGmail(gmailMessage('a'));
    await setActive(db, true);
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'a' })], '2');
    // Sift could not place it, and marked it for the user in Gmail.
    const sources = { api: { getContent: async () => null, getThread: async () => null }, mailbox };
    await triageAccount({ db, mailbox, model: { model: 'test/model', judge: unsure }, sources, now: () => 10 }, (await listAccounts(db))[0]!);
    const marked = mailbox.labels.get('a')!;
    expect(marked.length).toBeGreaterThan(1);
    // Now a rule says what it is.
    await addRule(db, ACCOUNT, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');
    await goOn(await begin(true), { on: true, now: () => 200 });
    const now = mailbox.labels.get('a')!;
    expect(now).not.toContain('INBOX');
    expect(now.filter((l) => marked.includes(l))).toEqual([]);
  });

  it('stops at its time limit, and carries on from there', async () => {
    inGmail(gmailMessage('a'), gmailMessage('b'), gmailMessage('c'), gmailMessage('d'), gmailMessage('e'));
    const run = await begin(false);
    expect(await goOn(run, { until: 0, now: () => 0 })).toMatchObject({ to: 0, of: 0 });
    expect(listed).toEqual([]);
    // Four at a time, each model call taking 10.
    let clock = 0;
    const slow = async () => ((clock += 10), await unsure());
    expect(await goOn(run, { until: 15, now: () => clock, judge: slow })).toMatchObject({ from: 0, to: 4, of: 5 });
    expect(await goOn(run)).toMatchObject({ from: 4, to: 5 });
    expect(asked.toSorted()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await goOn(run)).toBeNull();
  });

  it('leaves what the model was not asked about for the next piece, in order', async () => {
    inGmail(...Array.from({ length: 13 }, (_, i) => gmailMessage(`m${i}`)));
    const run = await begin(false, { most: 20 });
    const down = async (): Promise<Awaited<ReturnType<typeof unsure>>> => {
      throw new Error('provider down');
    };
    // Three failures in a row and each of the four stops asking: the thirteenth is not asked.
    expect(await goOn(run, { judge: down })).toMatchObject({ to: 12, of: 13 });
    expect(asked).toHaveLength(12);
    await goOn(run);
    expect(asked.at(-1)).toBe('m12');
    expect(await raw(db).all('SELECT finished_at FROM inbox_runs')).toEqual([{ finished_at: 100 }]);
  });

  it('stops when the person stops it, keeping what it decided', async () => {
    inGmail(gmailMessage('a'), gmailMessage('b'), gmailMessage('c'), gmailMessage('d'), gmailMessage('e'));
    const run = await begin(false);
    await goOn(run, { judge: async () => (await stopInboxRuns(db, 70), await unsure()) });
    expect(asked).toHaveLength(4);
    expect(await raw(db).all('SELECT next, finished_at, stopped FROM inbox_runs')).toEqual([{ next: 4, finished_at: 70, stopped: true }]);
    expect(await goOn(run)).toBeNull();
    expect(await inboxProgress(db, [ACCOUNT])).toEqual({ going: null, last: { finishedAt: 70, total: 4, spent: 0, stopped: true } });
  });

  it('says where it has got, what it has spent, and that more suggestions are coming', async () => {
    const { call } = await startDashboard(people(store), { controls });
    const importing = async () => ((await call('GET', '/api/suggestions')).body as { importing: boolean }).importing;
    expect(await importing()).toBe(false);
    inGmail(gmailMessage('a'), gmailMessage('b'), gmailMessage('c'), gmailMessage('d'), gmailMessage('e'));
    const run = await begin(false);
    expect(await importing()).toBe(true);
    let clock = 100;
    await goOn(run, { until: 115, now: () => clock, judge: async () => ((clock += 10), await unsure()) });
    await raw(db).run("UPDATE model_runs SET cost_usd = 0.01 WHERE message_id IN ('a', 'b')");
    expect((await call('GET', '/api/manage')).body).toMatchObject({
      inbox: { going: { listed: true, done: 4, total: 5, spent: 0.02, startedAt: 50 }, last: null },
    });
    await goOn(run);
    expect(await importing()).toBe(false);
    expect((await call('GET', '/api/manage')).body).toMatchObject({ inbox: { going: null, last: { total: 5, spent: 0.02, stopped: false } } });
  });

  it('estimates from what model calls cost lately and how much mail went to the model, once there are enough of each', async () => {
    expect(await averageCall(db)).toBeNull();
    expect(await modelShare(db, 0)).toBeNull();
    const ids = Array.from({ length: 20 }, (_, i) => `e${i}`);
    await recordSync(
      db,
      ACCOUNT,
      ids.map((messageId) => facts({ accountId: ACCOUNT, messageId })),
      '2',
    );
    for (const [i, id] of ids.entries()) {
      const run = await startRun(db, { accountId: ACCOUNT, messageId: id, model: 'test/model', now: 10 });
      await finishRun(db, run, { usage: { model: 'test/model', inputTokens: 1000, outputTokens: 100, costUsd: i < 10 ? 0.001 : 0.003 }, now: 11 });
      // Half went to the model.
      const said = { disposition: 'keep', subscription: 'preserve', stage: i % 2 ? 'model' : 'rules', reason: 'r' } as const;
      await recordDecision(db, ACCOUNT, id, said, { carryOut: false, now: 10, ...(i % 2 ? { runId: run } : {}) });
    }
    // A provider that reported no usage says nothing.
    const silent = await startRun(db, { accountId: ACCOUNT, messageId: 'e0', model: 'test/model', now: 10 });
    await finishRun(db, silent, { now: 11 });
    expect(await averageCall(db, 'test/model')).toEqual({ costUsd: expect.closeTo(0.002), inputTokens: 1000, outputTokens: 100 });
    // Calls on another model still say how big the person's calls are.
    expect(await averageCall(db, 'other/model')).toBeNull();
    expect(await averageCall(db)).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
    expect(await modelShare(db, 0)).toBe(0.5);
    expect(await modelShare(db, 11)).toBeNull();
  });

  it('is started for each mailbox of the person, once at a time, and acts only if Sift was on', async () => {
    const { call } = await startDashboard(people(store), { controls });
    expect((await call('POST', '/api/inbox/start', { reach: 'recent' })).body).toEqual({ ok: true });
    expect(await call('POST', '/api/inbox/start', { reach: 'inbox' })).toMatchObject({
      status: 409,
      body: { error: 'Sift is already going through your inbox.' },
    });
    expect(await raw(db).all('SELECT account_id, acts, most FROM inbox_runs')).toEqual([{ account_id: ACCOUNT, acts: false, most: REACH.recent }]);
    expect((await call('POST', '/api/inbox/stop', {})).body).toEqual({ ok: true });
    await setActive(db, true);
    await call('POST', '/api/inbox/start', { reach: 'inbox' });
    expect(await raw(db).all('SELECT acts, most, stopped FROM inbox_runs ORDER BY id')).toEqual([
      { acts: false, most: REACH.recent, stopped: true },
      { acts: true, most: REACH.inbox, stopped: false },
    ]);
    expect((await call('GET', '/api/inbox?reach=inbox')).body).toEqual({ messages: 40, model: 30, cost: 0.03 });
    expect(calls).toEqual(['check', 'check', 'estimate inbox']);
  });
});

describe('ticks', () => {
  it('ticks that overlap skip work another has under way', async () => {
    let passes = 0;
    const options: RunOptions = {
      ephemeral: memoryEphemeral(),
      connect: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        passes++;
        throw new Error('offline');
      },
      log: () => {},
    };
    await Promise.all([tick(store, options, Infinity), tick(store, options, Infinity), tick(store, options, Infinity)]);
    expect(passes).toBe(1);
  });

  it('deletes examples a year after their answer, when it starts and once a day after', async () => {
    const DAY = 86_400_000;
    await storeExample(db, ACCOUNT, { id: 'old', from: 'a@example.org', label: 'personal', markedAt: 0 });
    await storeExample(db, ACCOUNT, { id: 'soon', from: 'd@example.org', label: 'personal', markedAt: 2 * DAY + DAY / 5 });
    await storeExample(db, ACCOUNT, { id: 'mid', from: 'b@example.org', label: 'personal', markedAt: 5 * DAY });
    await storeExample(db, ACCOUNT, { id: 'new', from: 'c@example.org', label: 'personal', markedAt: 12 * DAY });
    const held = async () => (await raw(db).all<{ message_id: string }>('SELECT message_id FROM examples ORDER BY marked_at')).map((r) => r.message_id);
    const logs: string[] = [];

    /** Tick once at each of the given times. */
    const ticksAt = async (times: number[]) => {
      const ephemeral = memoryEphemeral();
      for (const at of times)
        await tick(
          store,
          {
            ephemeral,
            connect: () => {
              throw new Error('offline');
            },
            log: (line) => logs.push(line),
            now: () => at,
          },
          Infinity,
        );
    };

    await ticksAt([12 * DAY]);
    expect(await held()).toEqual(['old', 'soon', 'mid', 'new']);

    // A year and two days on, only `old` is past it. Half a day later `soon` is too, but upkeep has run
    // today, so it waits; three days on, it goes with `mid`.
    const year = EXAMPLE_KEEP_DAYS * DAY;
    await ticksAt([year + 2 * DAY, year + 2.5 * DAY, year + 5.5 * DAY]);
    expect(logs.filter((l) => l.startsWith('Deleted'))).toEqual(['Deleted 1 example older than 365 days', 'Deleted 2 examples older than 365 days']);
    expect(await held()).toEqual(['new']);
  });
});
