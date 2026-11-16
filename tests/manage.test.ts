import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_BACKFILL, backfill } from '../src/work/backfill.ts';
import { memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { type RunOptions, tick } from '../src/work/run.ts';
import { triageAccount } from '../src/work/triage.ts';
import type { Controls, SignIn } from '../src/dashboard/controls.ts';
import { people } from '../src/store/people.ts';
import type { RawMessage } from '../src/gmail/api.ts';
import { continueEval, startEval } from '../src/learn/evals.ts';
import { connectAccount, listAccounts, recordSync } from '../src/store/accounts.ts';
import { MAX_LABELS, listLabels } from '../src/store/labels.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { EXAMPLE_KEEP_DAYS } from '../src/store/examples.ts';
import { preferences, setActive } from '../src/store/preferences.ts';
import { addRule, listRules } from '../src/store/rules.ts';
import { FakeMailbox, facts, storeExample } from './helpers.ts';
import { type Reply, builtAssets, raw, startDashboard, onePerson } from './fixtures.ts';
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
  backfill: async (days) => void calls.push(`backfill ${days}`),
  putBack: async (_db, _account, messageId) => {
    calls.push(`putBack ${messageId}`);
    if (messageId === 'gone') throw new Error('The message no longer exists.');
    return true;
  },
  startEval: async (_db, { accountId, fewShot, limit }) => {
    calls.push(`eval ${accountId} ${fewShot} ${limit}`);
    return 7;
  },
  ruleFilter: async (target, ruleId, on) => {
    calls.push(`filter ${ruleId} ${on ? 'on' : 'off'}`);
    await raw(target).run(`UPDATE rules SET filter_id = ?, filter_state = ? WHERE id = ?`, on ? 'f1' : null, on ? 'active' : null, ruleId);
  },
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
    for (const bad of [{}, { active: 'yes' }, { active: true, interval: 60 }]) expect((await call('POST', '/api/active', bad)).status).toBe(400);
    expect((await call('POST', '/api/active', { active: false })).status).toBe(200);
    expect((await preferences(db)).active).toBe(false);
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

  it("lists the examples it holds without their content, and deletes one or all of an account's", async () => {
    const { call } = await start();
    await storeExample(db, ACCOUNT, { id: 'e1', from: 'news@example.com', label: 'newsletter', body: 'Private words.', markedAt: 1, name: 'News' });
    await storeExample(db, ACCOUNT, { id: 'e2', from: 'ada@example.org', label: 'personal', markedAt: 2 });
    await storeExample(db, ACCOUNT, { id: 'e3', from: 'bob@example.org', label: 'personal', markedAt: 3 });
    await connectAccount(store, 'other@example.org', '1', 0, 1);
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
    const marketing = { disposition: 'archive', subscription: 'unsubscribe', stage: 'model', reason: 'Marketing: a sale', labelId: 'marketing' } as const;
    await recordDecision(db, ACCOUNT, 'w1', marketing, { now: 10 });
    await recordDecision(db, ACCOUNT, 'w2', marketing, { now: 20 });
    const latest = async (id: string) =>
      await raw(db).get('SELECT stage, disposition, label_id FROM decisions WHERE message_id = ? ORDER BY id DESC LIMIT 1', id);

    const label = await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', disposition: 'keep' });
    expect(label.body).toEqual({ ok: true, redecided: 2 });
    expect(await latest('w1')).toEqual({ stage: 'model', disposition: 'keep', label_id: 'marketing' });

    const rule = await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: from.address }, label: 'newsletter' });
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
    const keepReplies = await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: from.address, facts: { isReply: true } }, disposition: 'keep' });
    expect(keepReplies.body).toMatchObject({ redecided: 1 });
    expect(await raw(db).get(`SELECT stage, disposition, reason FROM decisions WHERE message_id = 'w1' ORDER BY id DESC LIMIT 1`)).toEqual({
      stage: 'rules',
      disposition: 'keep',
      reason: 'rule: from sales@example.com, is a reply: keep it',
    });
    expect(await latest('w2')).toEqual({ stage: 'model', disposition: 'keep', label_id: 'marketing' });
  });

  it('edits labels and rules', async () => {
    const { call } = await start();

    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'newsletter', disposition: 'keep', name: 'Reading' })).status).toBe(200);
    expect((await listLabels(db, ACCOUNT)).find((l) => l.id === 'newsletter')).toMatchObject({
      disposition: 'keep',
      name: 'Reading',
      gmailLabel: 'sift/newsletters',
    });
    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'nonsense', disposition: 'keep' })).status).toBe(409);
    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'newsletter', disposition: 'delete' })).status).toBe(400);

    const mine = await call('POST', '/api/labels/add', {
      accountId: ACCOUNT,
      name: 'Investor updates',
      description: 'Updates from companies I invested in.',
      disposition: 'keep',
    });
    expect(mine.body).toEqual({ id: 'investor-updates' });
    expect((await listLabels(db, ACCOUNT)).at(-1)).toEqual({
      id: 'investor-updates',
      name: 'Investor updates',
      description: 'Updates from companies I invested in.',
      disposition: 'keep',
      gmailLabel: 'sift/investor-updates',
    });
    for (const taken of ['investor updates', 'Review', 'Did', 'Cold outreach', '!!!'])
      expect((await call('POST', '/api/labels/add', { accountId: ACCOUNT, name: taken, description: '', disposition: 'keep' })).status).toBe(409);
    expect((await call('POST', '/api/labels/add', { accountId: 'nobody@example.org', name: 'X', description: '', disposition: 'keep' })).status).toBe(404);
    // Up to the limit, and no further.
    for (let n = (await listLabels(db, ACCOUNT)).length; n < MAX_LABELS; n++)
      expect((await call('POST', '/api/labels/add', { accountId: ACCOUNT, name: `Extra ${n}`, description: '', disposition: 'keep' })).status).toBe(200);
    const full = await call('POST', '/api/labels/add', { accountId: ACCOUNT, name: 'One too many', description: '', disposition: 'keep' });
    expect(full.status).toBe(409);
    expect((await listLabels(db, ACCOUNT)).length).toBe(MAX_LABELS);

    const added = await call('POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { fromDomain: 'example.com', subjectContains: '' },
      label: 'investor-updates',
    });
    const excepted = await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: 'a@example.com' }, label: 'marketing', disposition: 'keep' });
    expect(await listRules(db, ACCOUNT)).toMatchObject([
      { id: added.body['id'], match: { fromDomain: 'example.com' }, labelId: 'investor-updates', source: 'user' },
      { id: excepted.body['id'], labelId: 'marketing', disposition: 'keep' },
    ]);
    expect((await listRules(db, ACCOUNT))[0]).not.toHaveProperty('disposition');
    expect((await call('GET', '/api/rules')).body['rules']).toMatchObject([
      { labelName: 'Investor updates', override: null, disposition: 'keep' },
      { labelName: 'Marketing', override: 'keep', disposition: 'keep' },
    ]);
    expect((await call('POST', '/api/rules', { accountId: ACCOUNT, match: {}, label: 'marketing' })).status).toBe(400);
    const onFacts = await call('POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { fromDomain: 'example.org', facts: { isReply: false, unsubscribe: ['header', 'none'], category: 'promotions' } },
      disposition: 'archive',
    });
    expect(onFacts.status).toBe(200);
    expect((await listRules(db, ACCOUNT)).find((r) => r.id === onFacts.body['id'])).toMatchObject({
      match: { fromDomain: 'example.org', facts: { isReply: false, unsubscribe: ['header', 'none'], category: 'promotions' } },
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
    expect((await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: 'a@example.com' }, label: 'no-such-label' })).status).toBe(409);
    expect((await call('POST', '/api/rules', { accountId: ACCOUNT, match: { from: 'a@example.com' }, label: 'marketing', disposition: 'review' })).status).toBe(
      400,
    );
    // With no filter recorded, Gmail is still asked: one sift wrote and lost track of goes with the rule.
    expect((await call('POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(200);
    expect(calls).toContain(`filter ${String(added.body['id'])} off`);
    expect((await call('POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(409);
  });

  it('sets what a label does, including blocking and marking read', async () => {
    const { call } = await start();
    const does = async () => (await listLabels(db, ACCOUNT)).find((l) => l.id === 'marketing');
    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', disposition: 'block' })).status).toBe(200);
    expect(await does()).toMatchObject({ disposition: 'spam', block: true });
    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', disposition: 'archive', markRead: true })).status).toBe(200);
    expect(await does()).toMatchObject({ disposition: 'archive', markRead: true });
    expect(await does()).not.toHaveProperty('block');
    const shown = ((await call('GET', '/api/manage')).body['labels'] as Record<string, { id: string; disposition: string; markRead: boolean }[]>)[ACCOUNT];
    expect(shown?.find((l) => l.id === 'marketing')).toMatchObject({ disposition: 'archive', markRead: true });
    expect(shown?.find((l) => l.id === 'phishing')).toMatchObject({ disposition: 'block', markRead: false });
    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'personal', unsubscribe: true })).status).toBe(200);
    expect((await listLabels(db, ACCOUNT)).find((l) => l.id === 'personal')).toMatchObject({ disposition: 'keep', unsubscribe: true });
    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'personal', unsubscribe: 'yes' })).status).toBe(400);
    const extra = await call('POST', '/api/rules', {
      accountId: ACCOUNT,
      match: { from: 'x@example.com' },
      label: 'security',
      unsubscribe: true,
      markRead: true,
    });
    expect((await listRules(db, ACCOUNT)).find((r) => r.id === extra.body['id'])).toMatchObject({ subscription: 'unsubscribe', markRead: true });
    // "Leave it for me" is no longer something a label can be set to do.
    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', disposition: 'review' })).status).toBe(400);
    expect((await call('POST', '/api/labels', { accountId: ACCOUNT, id: 'marketing', markRead: 'yes' })).status).toBe(400);
    expect((await call('POST', '/api/labels/add', { accountId: ACCOUNT, name: 'Scams', description: '', disposition: 'block' })).body).toEqual({
      id: 'scams',
    });
    expect((await listLabels(db, ACCOUNT)).at(-1)).toMatchObject({ id: 'scams', disposition: 'spam', block: true });
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
    const answer = { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'once' };
    expect((await call('POST', '/api/feedback', { ...answer, messageId: 'done' })).body).toMatchObject({
      corrected: 'done',
      fixed: 'What Sift did to this message in Gmail has been taken back.',
      notFixed: null,
    });
    const failed = await call('POST', '/api/feedback', { ...answer, messageId: 'gone' });
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ fixed: null, notFixed: 'The message no longer exists.' });
    expect(await raw(db).get('SELECT count(*) AS n FROM feedback')).toEqual({ n: 2 });
    expect(calls).toEqual(['putBack done', 'putBack gone']);
  });

  it('asks the running sift to undo, pull in older mail and check now', async () => {
    const { call } = await start();
    await raw(db).run(
      `INSERT INTO actions (id, account_id, type, payload, original_labels, status, created_at) VALUES (3, ?, 'archive', '{}', '[]', 'done', 1)`,
      ACCOUNT,
    );
    expect((await call('POST', '/api/undo', { id: 3 })).body).toEqual({ message: null });
    // A change that is not in this person's database is not passed on.
    expect(await call('POST', '/api/undo', { id: 404 })).toMatchObject({ status: 409, body: { error: 'There is no change #404.' } });
    expect((await call('POST', '/api/backfill', { days: 7 })).body).toEqual({ ok: true });
    expect((await call('POST', '/api/backfill', { days: 400 })).status).toBe(400);
    expect((await call('POST', '/api/check', {})).status).toBe(200);
    expect(calls).toEqual(['undo 3', 'backfill 7', 'check']);
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
      '/api/undo',
      '/api/backfill',
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

  it('writes a rule to Gmail as a filter only while sift is on, and removes the filter with the rule', async () => {
    const { call } = await start();
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    const spam = await addRule(db, ACCOUNT, { match: { from: 'junk@example.com' }, labelId: 'junk' }, 'user');
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
    expect(await add({ match: { from: 'news@example.com' }, label: 'newsletter' })).toBeNull();
    await setActive(db, true);
    expect(await add({ match: { from: 'digest@example.com' }, label: 'newsletter' })).toMatchObject({
      possible: true,
      plan: { criteria: { from: 'digest@example.com' }, gmailLabel: 'sift/newsletters', archive: true },
    });
    expect(await add({ match: { from: 'junk@example.com' }, label: 'junk' })).toBeNull();
    expect(await add({ match: { from: 'shop@example.com' }, label: 'marketing', when: 'it is a sale' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('takes a standing back with its Gmail filter, as removing the rule does', async () => {
    const { call } = await start();
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, disposition: 'archive' }, 'user');
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
  let hasClient: boolean;
  const signIn: SignIn = {
    hasClient: () => hasClient,
    url: (redirectUri, state, challenge) => `https://accounts.example/auth?redirect=${encodeURIComponent(redirectUri)}&state=${state}&challenge=${challenge}`,
    complete: async (redirectUri, code, _verifier, addTo) => {
      completed.push(`${redirectUri} ${code} addTo=${addTo}`);
      if (code === 'refused') throw new Error('Google refused the sign-in.');
      if (code === 'second') {
        await connectAccount(store, 'work@example.com', '1', 0, 1);
        return 'work@example.com';
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

  it('says why a sign-in failed, and adds a second account only for someone signed in', async () => {
    const { call } = await startWithSignIn();
    const login = await call('GET', '/auth/login?add=1');
    const refused = await callback(call, login, 'refused');
    expect(decodeURIComponent(String(refused.headers['location']))).toBe('/?signin=Google refused the sign-in.');
    expect(String(refused.headers['set-cookie'])).not.toContain('sift_session');
    expect(completed.at(-1)).toContain('addTo=null');

    const first = await call('GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await callback(call, first, 'abc')).headers) };
    const add = await call('GET', '/auth/login?add=1', undefined, cookie);
    const added = await callback(call, add, 'second', cookie);
    // The account being added joins the mailboxes of whoever is signed in.
    expect(completed.at(-1)).toContain(`addTo=${ACCOUNT}`);
    expect((await call('GET', '/api/session', undefined, { cookie: cookieFrom(added.headers) })).body).toMatchObject({ email: 'work@example.com' });
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

describe('older mail', () => {
  const gmailMessage = (id: string): RawMessage => ({
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
      getMetadata: async (id: string) => (calls.push(id), id === 'gone' ? null : gmailMessage(id)),
    };
    expect(await backfill(db, api, ACCOUNT, 7)).toBe(true);
    expect(await backfill(db, api, ACCOUNT, 7)).toBe(true);
    // The second time it reads only what it could not record.
    expect(calls).toEqual(['newer_than:7d', 'a', 'b', 'gone', 'newer_than:7d', 'gone']);
    expect((await listAccounts(db))[0]?.historyId).toBe('1');
    expect(await raw(db).all('SELECT id, suggest_only FROM messages ORDER BY id')).toEqual([
      { id: 'a', suggest_only: true },
      { id: 'b', suggest_only: true },
    ]);
  });

  it('stops at its time limit with what it fetched kept, and carries on from there', async () => {
    let clock = 0;
    const read: string[] = [];
    const api = {
      searchInbox: async () => ({ ids: ['a', 'b', 'c'] }),
      getMetadata: async (id: string) => (read.push(id), (clock += 1000), gmailMessage(id)),
    };
    expect(await backfill(db, api, ACCOUNT, 7, 1500, () => clock)).toBe(false);
    expect(await raw(db).all('SELECT id FROM messages ORDER BY id')).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(await backfill(db, api, ACCOUNT, 7, Infinity, () => clock)).toBe(true);
    expect(read).toEqual(['a', 'b', 'c']);
  });

  it('stops at the cap', async () => {
    let page = 0;
    const api = {
      searchInbox: async () => ({ ids: Array.from({ length: 200 }, (_, i) => `p${page}-${i}`), nextPageToken: `t${++page}` }),
      getMetadata: async (id: string) => gmailMessage(id),
    };
    expect(await backfill(db, api, ACCOUNT, 30)).toBe(true);
    expect(page).toBe(2);
    expect(await raw(db).get('SELECT count(*) AS n FROM messages')).toEqual({ n: MAX_BACKFILL });
  });

  it('is only ever suggested about, even while sift is on', async () => {
    await backfill(db, { searchInbox: async () => ({ ids: ['old'] }), getMetadata: async (id) => gmailMessage(id) }, ACCOUNT, 7);
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'new' })], '2');
    const mailbox = new FakeMailbox();
    mailbox.labels.set('old', ['INBOX']);
    mailbox.labels.set('new', ['INBOX']);
    // A model that can place neither, so each gets a decision: what is being tested is which may be acted on.
    const sources = { api: { getContent: async () => null, getThread: async () => null }, mailbox: { hasSentTo: async () => false } };
    const model = {
      model: 'test/model',
      judge: async () => ({ label: 'unsure', reason: 'cannot tell', confidence: 0.2 }),
    };
    await triageAccount({ db, mailbox, model, sources }, (await listAccounts(db))[0]!);
    expect(await raw(db).all('SELECT message_id, carry_out, outcome FROM decisions ORDER BY message_id')).toEqual([
      { message_id: 'new', carry_out: true, outcome: 'done' },
      { message_id: 'old', carry_out: false, outcome: null },
    ]);
    expect(mailbox.labels.get('old')).toEqual(['INBOX']);
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
