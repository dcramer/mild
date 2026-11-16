import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_REJUDGE, rejudgeWaiting } from '../src/daemon/rejudge.ts';
import { applyFeedback, pendingSuggestions } from '../src/learn/feedback.ts';
import { predatingGuidelines, redecideWaiting } from '../src/learn/redecide.ts';
import { addMailbox, listAccounts, recordSync } from '../src/store/accounts.ts';
import { openUserDb } from '../src/store/db.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { updateLabel } from '../src/store/labels.ts';
import { addRule, listRules, removeRule } from '../src/store/rules.ts';
import { rememberCorrespondent } from '../src/store/senders.ts';
import type { JudgeInput } from '../src/triage/stages/model.ts';
import type { Decision } from '../src/triage/types.ts';
import { FakeMailbox, facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
let db: Sql;
let serial: number;

const MARKETING = { disposition: 'archive', labelId: 'marketing', gmailLabel: 'sift/marketing', subscription: 'unsubscribe' } as const;

/** A message from `address` with the decision sift made for it while observing. Returns the message id. */
async function decided(address: string, decision: Partial<Decision> = {}, at = ++serial): Promise<string> {
  const id = `m${++serial}`;
  await recordSync(
    db,
    ACCOUNT,
    [facts({ accountId: ACCOUNT, messageId: id, from: { address, domain: address.split('@')[1] ?? '' }, subject: `Subject ${id}` })],
    '2',
  );
  await recordDecision(
    db,
    ACCOUNT,
    id,
    { disposition: 'review', subscription: 'preserve', stage: 'agent', reason: 'Marketing: a sale', ...decision },
    { now: at },
  );
  return id;
}

const current = async (messageId: string) =>
  await db.get(
    'SELECT stage, disposition, label_id, rule_id, subscription, reason, model, cost_usd, mode FROM decisions WHERE message_id = ? ORDER BY id DESC LIMIT 1',
    messageId,
  );
const count = async () => (await db.get<{ n: number }>('SELECT count(*) AS n FROM decisions'))!.n;
const waiting = async () => (await pendingSuggestions(db)).map((s) => s.messageId).toSorted();

beforeEach(async () => {
  db = await openUserDb(':memory:');
  await addMailbox(db, ACCOUNT, '1', 0);
  serial = 0;
});

describe('when a rule changes', () => {
  it("a new rule of the user's settles the waiting mail it matches, and nothing else", async () => {
    const sale = await decided('sales@example.com', MARKETING);
    const other = await decided('ada@example.org', { disposition: 'keep', labelId: 'personal' });
    const ruleId = await addRule(db, ACCOUNT, { match: { from: 'sales@example.com' }, labelId: 'newsletter' }, 'user');

    expect(await redecideWaiting(db, ACCOUNT, 50)).toBe(1);
    expect(await current(sale)).toMatchObject({
      stage: 'rules',
      disposition: 'archive',
      label_id: 'newsletter',
      rule_id: ruleId,
      model: null,
      cost_usd: 0,
      mode: 'observe',
    });
    expect(await waiting()).toEqual([other]);
    expect((await listRules(db, ACCOUNT))[0]?.hits).toBe(1);
    expect(await redecideWaiting(db, ACCOUNT, 60)).toBe(0);
  });

  it('removing that rule brings the suggestion back as the model left it', async () => {
    const sale = await decided('sales@example.com', { ...MARKETING, confidence: 0.9 });
    const arrivedUnderRule = await (async () => {
      const ruleId = await addRule(db, ACCOUNT, { match: { from: 'sales@example.com' }, labelId: 'newsletter' }, 'user');
      const id = await decided('sales@example.com', { stage: 'rules', ruleId, disposition: 'archive', labelId: 'newsletter' });
      return { id, ruleId };
    })();
    await redecideWaiting(db, ACCOUNT);
    expect(await waiting()).toEqual([]);

    await removeRule(db, arrivedUnderRule.ruleId);
    expect(await redecideWaiting(db, ACCOUNT)).toBe(1);
    expect(await current(sale)).toMatchObject({
      stage: 'agent',
      disposition: 'archive',
      label_id: 'marketing',
      rule_id: null,
      reason: 'Marketing: a sale',
      cost_usd: 0,
    });
    expect(await waiting()).toEqual([sale]);
    // Mail the rule decided when it arrived is history, not a suggestion to bring back.
    expect(await current(arrivedUnderRule.id)).toMatchObject({ stage: 'rules', rule_id: arrivedUnderRule.ruleId });
  });

  it('goes back to review when no tier had placed it before the rule', async () => {
    const lost = await decided('who@example.com', { stage: 'fallback', reason: 'no stage reached a decision' });
    const ruleId = await addRule(db, ACCOUNT, { match: { from: 'who@example.com' }, labelId: 'junk' }, 'user');
    await redecideWaiting(db, ACCOUNT);
    await removeRule(db, ruleId);
    await redecideWaiting(db, ACCOUNT);
    expect(await current(lost)).toMatchObject({ stage: 'fallback', disposition: 'review', label_id: null });
    expect(await waiting()).toEqual([lost]);
  });

  it('never touches mail the user answered for', async () => {
    const sale = await decided('sales@example.com', MARKETING);
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'sales@example.com', label: 'newsletter', scope: 'sender' });
    const answered = await decided('shop@example.com', { stage: 'rules', disposition: 'keep', labelId: 'transactional' });
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'shop@example.com', label: 'marketing', scope: 'sender', messageId: answered });
    for (const rule of await listRules(db, ACCOUNT)) await removeRule(db, rule.id);

    const before = await count();
    expect(await redecideWaiting(db, ACCOUNT)).toBe(0);
    expect(await count()).toBe(before);
    expect(await current(sale)).toMatchObject({ stage: 'agent', label_id: 'marketing' });
    expect(await current(answered)).toMatchObject({ stage: 'rules', label_id: 'marketing' });
  });

  it('a rule sift learned changes a suggestion only when the outcome differs', async () => {
    const sale = await decided('sales@example.com', MARKETING);
    await addRule(db, ACCOUNT, { match: { from: 'sales@example.com' }, labelId: 'marketing' }, 'agent');
    expect(await redecideWaiting(db, ACCOUNT)).toBe(0);

    await updateLabel(db, ACCOUNT, 'marketing', { disposition: 'keep' });
    const underLearned = await decided('sales@example.com', {
      stage: 'rules',
      ruleId: (await listRules(db, ACCOUNT))[0]!.id,
      disposition: 'archive',
      labelId: 'marketing',
    });
    expect(await redecideWaiting(db, ACCOUNT)).toBe(2);
    expect(await current(sale)).toMatchObject({ stage: 'rules', disposition: 'keep', label_id: 'marketing' });
    expect(await current(underLearned)).toMatchObject({ stage: 'rules', disposition: 'keep' });
    expect(await waiting()).toEqual([sale, underLearned].toSorted());
  });
});

describe("when a label's outcome changes", () => {
  it('waiting mail with that label gets the new outcome under the same label, without a model', async () => {
    const sale = await decided('sales@example.com', {
      ...MARKETING,
      confidence: 0.7,
      usage: { model: 'p/m', inputTokens: 900, outputTokens: 10, costUsd: 0.002 },
    });
    const other = await decided('news@example.com', { disposition: 'archive', labelId: 'newsletter', subscription: 'unsubscribe' });
    await updateLabel(db, ACCOUNT, 'marketing', { disposition: 'keep', unsubscribe: false });

    expect(await redecideWaiting(db, ACCOUNT, 80)).toBe(1);
    expect(await current(sale)).toEqual({
      stage: 'agent',
      disposition: 'keep',
      label_id: 'marketing',
      rule_id: null,
      subscription: 'preserve',
      reason: 'Marketing is now kept. Before: Marketing: a sale',
      model: null,
      cost_usd: 0,
      mode: 'observe',
    });
    expect(await current(other)).toMatchObject({ disposition: 'archive', reason: 'Marketing: a sale' });
    expect(await waiting()).toEqual([sale, other].toSorted());
    expect(await redecideWaiting(db, ACCOUNT)).toBe(0);

    // Changing it again does not pile explanations up.
    await updateLabel(db, ACCOUNT, 'marketing', { disposition: 'spam' });
    await redecideWaiting(db, ACCOUNT);
    expect(await current(sale)).toMatchObject({
      disposition: 'review',
      reason: expect.stringMatching(/^Marketing is now marked as spam, but .* Before: Marketing: a sale$/),
    });
  });

  it('never starts hiding mail from a sender who was not checked', async () => {
    const unknown = await decided('ada@example.org', { disposition: 'keep', labelId: 'personal', reason: 'Personal: a note' });
    const stranger = await decided('bob@example.org', { disposition: 'keep', labelId: 'personal', reason: 'Personal: a note' });
    const friend = await decided('cy@example.org', { disposition: 'keep', labelId: 'personal', reason: 'Personal: a note' });
    await rememberCorrespondent(db, ACCOUNT, 'bob@example.org', false, 90);
    await rememberCorrespondent(db, ACCOUNT, 'cy@example.org', true, 90);
    await updateLabel(db, ACCOUNT, 'personal', { disposition: 'archive' });

    expect(await redecideWaiting(db, ACCOUNT, 100)).toBe(3);
    expect(await current(unknown)).toMatchObject({ disposition: 'review', label_id: 'personal', reason: expect.stringContaining('is not known') });
    expect(await current(stranger)).toMatchObject({ disposition: 'archive', label_id: 'personal' });
    expect(await current(friend)).toMatchObject({ disposition: 'review', reason: expect.stringContaining('you have written to this sender') });
  });

  it('leaves mail sift could not place alone', async () => {
    await decided('who@example.com', { stage: 'fallback' });
    await decided('unsure@example.com', { stage: 'agent', reason: 'could be either' });
    await updateLabel(db, ACCOUNT, 'marketing', { disposition: 'keep' });
    expect(await redecideWaiting(db, ACCOUNT)).toBe(0);
  });
});

describe('when the guidelines change', () => {
  const judged: string[] = [];
  const model = (label: string | null) => ({
    judge: async (input: JudgeInput) => {
      judged.push(input.evidence.facts.messageId);
      return label === null ? null : { label, reason: 'fits the new guidelines', usage: { model: 'p/m', inputTokens: 500, outputTokens: 10, costUsd: 0.001 } };
    },
    guidelines: 'Sales mail is junk.',
    sources: { api: { getContent: async () => ({ text: 'text', facts: { hasAttachments: false } }), getThread: async () => null }, mailbox: new FakeMailbox() },
  });

  it('counts the waiting mail judged before the change, and judges it again only when asked', async () => {
    judged.length = 0;
    const early = await decided('sales@example.com', MARKETING, 100);
    const lost = await decided('who@example.com', { stage: 'fallback' }, 150);
    const late = await decided('late@example.com', MARKETING, 300);
    const ruled = await decided(
      'rule@example.com',
      { stage: 'rules', ruleId: await addRule(db, ACCOUNT, { match: { from: 'rule@example.com' }, labelId: 'marketing' }, 'agent') },
      100,
    );

    expect((await predatingGuidelines(db, 200, ACCOUNT)).map((s) => s.messageId)).toEqual([early, lost]);
    expect(await predatingGuidelines(db, 200, 'other@example.org')).toEqual([]);
    expect(judged).toEqual([]);

    const [account] = await listAccounts(db);
    const run = await rejudgeWaiting({ db, mailbox: null, model: model('junk'), now: () => 400 }, account!, 200);
    expect(run).toMatchObject({ started: 2, remaining: 0 });
    await run.done;
    expect(judged).toEqual([early, lost]);
    expect(await current(early)).toMatchObject({ stage: 'agent', disposition: 'spam', label_id: 'junk', mode: 'observe', cost_usd: 0.001 });
    expect(await current(late)).toMatchObject({ label_id: 'marketing' });
    expect(await current(ruled)).toMatchObject({ stage: 'rules' });
    expect(await predatingGuidelines(db, 200, ACCOUNT)).toEqual([]);
    expect(await waiting()).toEqual([early, lost, late, ruled].toSorted());
    // Judging one message twice is not grounds for a rule about its sender.
    expect(await listRules(db, ACCOUNT)).toHaveLength(1);
  });

  it('keeps the old decision, still out of date, when the model cannot answer', async () => {
    const early = await decided('sales@example.com', MARKETING, 100);
    const [account] = await listAccounts(db);
    const before = await count();
    await (
      await rejudgeWaiting({ db, mailbox: null, model: model(null) }, account!, 200)
    ).done;
    expect(await count()).toBe(before);
    expect((await predatingGuidelines(db, 200, ACCOUNT)).map((s) => s.messageId)).toEqual([early]);
  });

  it('judges a batch at a time and says what is left', async () => {
    judged.length = 0;
    for (let i = 0; i < MAX_REJUDGE + 5; i++) await decided(`s${i}@example.com`, MARKETING, 100);
    const [account] = await listAccounts(db);
    const run = await rejudgeWaiting({ db, mailbox: null, model: model('marketing'), now: () => 400 }, account!, 200);
    expect(run).toMatchObject({ started: MAX_REJUDGE, remaining: 5 });
    await run.done;
    expect(judged).toHaveLength(MAX_REJUDGE);
    expect(await predatingGuidelines(db, 200, ACCOUNT)).toHaveLength(5);
  });
});
