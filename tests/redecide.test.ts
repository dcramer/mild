import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_REJUDGE, rejudgeWaiting } from '../src/daemon/rejudge.ts';
import { applyFeedback, pendingSuggestions } from '../src/learn/feedback.ts';
import { predatingGuidelines, redecideWaiting } from '../src/learn/redecide.ts';
import { connectAccount, listAccounts, recordSync } from '../src/store/accounts.ts';
import { openDb } from '../src/store/db.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { updateLabel } from '../src/store/labels.ts';
import { addRule, listRules, removeRule } from '../src/store/rules.ts';
import { rememberCorrespondent } from '../src/store/senders.ts';
import type { JudgeInput } from '../src/triage/stages/model.ts';
import type { Decision } from '../src/triage/types.ts';
import { FakeMailbox, facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
let db: DatabaseSync;
let serial: number;

const MARKETING = { disposition: 'archive', labelId: 'marketing', gmailLabel: 'sift/marketing', subscription: 'unsubscribe' } as const;

/** A message from `address` with the decision sift made for it while observing. Returns the message id. */
function decided(address: string, decision: Partial<Decision> = {}, at = ++serial): string {
  const id = `m${++serial}`;
  recordSync(
    db,
    ACCOUNT,
    [facts({ accountId: ACCOUNT, messageId: id, from: { address, domain: address.split('@')[1] ?? '' }, subject: `Subject ${id}` })],
    '2',
  );
  recordDecision(db, ACCOUNT, id, { disposition: 'review', subscription: 'preserve', stage: 'agent', reason: 'Marketing: a sale', ...decision }, { now: at });
  return id;
}

const current = (messageId: string) =>
  db
    .prepare(
      'SELECT stage, disposition, label_id, rule_id, subscription, reason, model, cost_usd, mode FROM decisions WHERE message_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(messageId);
const count = () => (db.prepare('SELECT count(*) AS n FROM decisions').get() as { n: number }).n;
const waiting = () =>
  pendingSuggestions(db)
    .map((s) => s.messageId)
    .toSorted();

beforeEach(() => {
  db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
  serial = 0;
});

describe('when a rule changes', () => {
  it("a new rule of the user's settles the waiting mail it matches, and nothing else", async () => {
    const sale = decided('sales@example.com', MARKETING);
    const other = decided('ada@example.org', { disposition: 'keep', labelId: 'personal' });
    const ruleId = addRule(db, ACCOUNT, { match: { from: 'sales@example.com' }, labelId: 'newsletter' }, 'user');

    expect(await redecideWaiting(db, ACCOUNT, 50)).toBe(1);
    expect(current(sale)).toMatchObject({
      stage: 'rules',
      disposition: 'archive',
      label_id: 'newsletter',
      rule_id: ruleId,
      model: null,
      cost_usd: 0,
      mode: 'observe',
    });
    expect(waiting()).toEqual([other]);
    expect(listRules(db, ACCOUNT)[0]?.hits).toBe(1);
    expect(await redecideWaiting(db, ACCOUNT, 60)).toBe(0);
  });

  it('removing that rule brings the suggestion back as the model left it', async () => {
    const sale = decided('sales@example.com', { ...MARKETING, confidence: 0.9 });
    const arrivedUnderRule = (() => {
      const ruleId = addRule(db, ACCOUNT, { match: { from: 'sales@example.com' }, labelId: 'newsletter' }, 'user');
      const id = decided('sales@example.com', { stage: 'rules', ruleId, disposition: 'archive', labelId: 'newsletter' });
      return { id, ruleId };
    })();
    await redecideWaiting(db, ACCOUNT);
    expect(waiting()).toEqual([]);

    removeRule(db, arrivedUnderRule.ruleId);
    expect(await redecideWaiting(db, ACCOUNT)).toBe(1);
    expect(current(sale)).toMatchObject({
      stage: 'agent',
      disposition: 'archive',
      label_id: 'marketing',
      rule_id: null,
      reason: 'Marketing: a sale',
      cost_usd: 0,
    });
    expect(waiting()).toEqual([sale]);
    // Mail the rule decided when it arrived is history, not a suggestion to bring back.
    expect(current(arrivedUnderRule.id)).toMatchObject({ stage: 'rules', rule_id: arrivedUnderRule.ruleId });
  });

  it('goes back to review when no tier had placed it before the rule', async () => {
    const lost = decided('who@example.com', { stage: 'fallback', reason: 'no stage reached a decision' });
    const ruleId = addRule(db, ACCOUNT, { match: { from: 'who@example.com' }, labelId: 'junk' }, 'user');
    await redecideWaiting(db, ACCOUNT);
    removeRule(db, ruleId);
    await redecideWaiting(db, ACCOUNT);
    expect(current(lost)).toMatchObject({ stage: 'fallback', disposition: 'review', label_id: null });
    expect(waiting()).toEqual([lost]);
  });

  it('never touches mail the user answered for', async () => {
    const sale = decided('sales@example.com', MARKETING);
    applyFeedback(db, { accountId: ACCOUNT, sender: 'sales@example.com', label: 'newsletter', scope: 'sender' });
    const answered = decided('shop@example.com', { stage: 'rules', disposition: 'keep', labelId: 'transactional' });
    applyFeedback(db, { accountId: ACCOUNT, sender: 'shop@example.com', label: 'marketing', scope: 'sender', messageId: answered });
    for (const rule of listRules(db, ACCOUNT)) removeRule(db, rule.id);

    const before = count();
    expect(await redecideWaiting(db, ACCOUNT)).toBe(0);
    expect(count()).toBe(before);
    expect(current(sale)).toMatchObject({ stage: 'agent', label_id: 'marketing' });
    expect(current(answered)).toMatchObject({ stage: 'rules', label_id: 'marketing' });
  });

  it('a rule sift learned changes a suggestion only when the outcome differs', async () => {
    const sale = decided('sales@example.com', MARKETING);
    addRule(db, ACCOUNT, { match: { from: 'sales@example.com' }, labelId: 'marketing' }, 'agent');
    expect(await redecideWaiting(db, ACCOUNT)).toBe(0);

    updateLabel(db, ACCOUNT, 'marketing', { disposition: 'keep' });
    const underLearned = decided('sales@example.com', { stage: 'rules', ruleId: listRules(db, ACCOUNT)[0]!.id, disposition: 'archive', labelId: 'marketing' });
    expect(await redecideWaiting(db, ACCOUNT)).toBe(2);
    expect(current(sale)).toMatchObject({ stage: 'rules', disposition: 'keep', label_id: 'marketing' });
    expect(current(underLearned)).toMatchObject({ stage: 'rules', disposition: 'keep' });
    expect(waiting()).toEqual([sale, underLearned].toSorted());
  });
});

describe("when a label's outcome changes", () => {
  it('waiting mail with that label gets the new outcome under the same label, without a model', async () => {
    const sale = decided('sales@example.com', { ...MARKETING, confidence: 0.7, usage: { model: 'p/m', inputTokens: 900, outputTokens: 10, costUsd: 0.002 } });
    const other = decided('news@example.com', { disposition: 'archive', labelId: 'newsletter', subscription: 'unsubscribe' });
    updateLabel(db, ACCOUNT, 'marketing', { disposition: 'keep', unsubscribe: false });

    expect(await redecideWaiting(db, ACCOUNT, 80)).toBe(1);
    expect(current(sale)).toEqual({
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
    expect(current(other)).toMatchObject({ disposition: 'archive', reason: 'Marketing: a sale' });
    expect(waiting()).toEqual([sale, other].toSorted());
    expect(await redecideWaiting(db, ACCOUNT)).toBe(0);

    // Changing it again does not pile explanations up.
    updateLabel(db, ACCOUNT, 'marketing', { disposition: 'spam' });
    await redecideWaiting(db, ACCOUNT);
    expect(current(sale)).toMatchObject({
      disposition: 'review',
      reason: expect.stringMatching(/^Marketing is now marked as spam, but .* Before: Marketing: a sale$/),
    });
  });

  it('never starts hiding mail from a sender who was not checked', async () => {
    const unknown = decided('ada@example.org', { disposition: 'keep', labelId: 'personal', reason: 'Personal: a note' });
    const stranger = decided('bob@example.org', { disposition: 'keep', labelId: 'personal', reason: 'Personal: a note' });
    const friend = decided('cy@example.org', { disposition: 'keep', labelId: 'personal', reason: 'Personal: a note' });
    rememberCorrespondent(db, ACCOUNT, 'bob@example.org', false, 90);
    rememberCorrespondent(db, ACCOUNT, 'cy@example.org', true, 90);
    updateLabel(db, ACCOUNT, 'personal', { disposition: 'archive' });

    expect(await redecideWaiting(db, ACCOUNT, 100)).toBe(3);
    expect(current(unknown)).toMatchObject({ disposition: 'review', label_id: 'personal', reason: expect.stringContaining('is not known') });
    expect(current(stranger)).toMatchObject({ disposition: 'archive', label_id: 'personal' });
    expect(current(friend)).toMatchObject({ disposition: 'review', reason: expect.stringContaining('you have written to this sender') });
  });

  it('leaves mail sift could not place alone', async () => {
    decided('who@example.com', { stage: 'fallback' });
    decided('unsure@example.com', { stage: 'agent', reason: 'could be either' });
    updateLabel(db, ACCOUNT, 'marketing', { disposition: 'keep' });
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
    const early = decided('sales@example.com', MARKETING, 100);
    const lost = decided('who@example.com', { stage: 'fallback' }, 150);
    const late = decided('late@example.com', MARKETING, 300);
    const ruled = decided(
      'rule@example.com',
      { stage: 'rules', ruleId: addRule(db, ACCOUNT, { match: { from: 'rule@example.com' }, labelId: 'marketing' }, 'agent') },
      100,
    );

    expect(predatingGuidelines(db, 200, ACCOUNT).map((s) => s.messageId)).toEqual([early, lost]);
    expect(predatingGuidelines(db, 200, 'other@example.org')).toEqual([]);
    expect(judged).toEqual([]);

    const [account] = listAccounts(db);
    const run = rejudgeWaiting({ db, mailbox: null, model: model('junk'), now: () => 400 }, account!, 200);
    expect(run).toMatchObject({ started: 2, remaining: 0 });
    await run.done;
    expect(judged).toEqual([early, lost]);
    expect(current(early)).toMatchObject({ stage: 'agent', disposition: 'spam', label_id: 'junk', mode: 'observe', cost_usd: 0.001 });
    expect(current(late)).toMatchObject({ label_id: 'marketing' });
    expect(current(ruled)).toMatchObject({ stage: 'rules' });
    expect(predatingGuidelines(db, 200, ACCOUNT)).toEqual([]);
    expect(waiting()).toEqual([early, lost, late, ruled].toSorted());
    // Judging one message twice is not grounds for a rule about its sender.
    expect(listRules(db, ACCOUNT)).toHaveLength(1);
  });

  it('keeps the old decision, still out of date, when the model cannot answer', async () => {
    const early = decided('sales@example.com', MARKETING, 100);
    const [account] = listAccounts(db);
    const before = count();
    await rejudgeWaiting({ db, mailbox: null, model: model(null) }, account!, 200).done;
    expect(count()).toBe(before);
    expect(predatingGuidelines(db, 200, ACCOUNT).map((s) => s.messageId)).toEqual([early]);
  });

  it('judges a batch at a time and says what is left', async () => {
    judged.length = 0;
    for (let i = 0; i < MAX_REJUDGE + 5; i++) decided(`s${i}@example.com`, MARKETING, 100);
    const [account] = listAccounts(db);
    const run = rejudgeWaiting({ db, mailbox: null, model: model('marketing'), now: () => 400 }, account!, 200);
    expect(run).toMatchObject({ started: MAX_REJUDGE, remaining: 5 });
    await run.done;
    expect(judged).toHaveLength(MAX_REJUDGE);
    expect(predatingGuidelines(db, 200, ACCOUNT)).toHaveLength(5);
  });
});
