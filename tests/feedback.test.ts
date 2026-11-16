import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEEP_BODY_DAYS, keepSuggestionBodies } from '../src/daemon/bodies.ts';
import { captureExamples, parseHeaders } from '../src/daemon/examples.ts';
import { triageAccount } from '../src/daemon/triage.ts';
import { listSuggestions, messageDetail, suggestionDetail, summarize } from '../src/dashboard/queries.ts';
import { createDashboardServer } from '../src/dashboard/server.ts';
import { accuracy, applyFeedback, pendingSuggestions } from '../src/learn/feedback.ts';
import { connectAccount, listAccounts, recordSync } from '../src/store/accounts.ts';
import { openDb } from '../src/store/db.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { addRule, listRules } from '../src/store/rules.ts';
import { rememberCorrespondent } from '../src/store/senders.ts';
import type { Decision, Disposition } from '../src/triage/types.ts';
import { facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
let db: DatabaseSync;
let serial = 0;

/** Record a message from `address` and what sift would do with it, while observing. */
function suggest(address: string, disposition: Disposition, extra: Partial<Decision> = {}): number {
  const id = `m${++serial}`;
  recordSync(
    db,
    ACCOUNT,
    [facts({ accountId: ACCOUNT, messageId: id, from: { address, domain: address.split('@')[1] ?? '' }, subject: `Subject ${id}` })],
    '2',
  );
  return recordDecision(db, ACCOUNT, id, { disposition, subscription: 'preserve', stage: 'agent', reason: 'looks like it', ...extra }, { now: serial });
}

beforeEach(() => {
  db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
  serial = 0;
});

/** The rule sift holds for one sender, without its bookkeeping. */
const ruleFor = (address: string) =>
  listRules(db, ACCOUNT)
    .filter((r) => r.match.from === address)
    .map(({ labelId, disposition, tier, source }) => ({ labelId, ...(disposition ? { disposition } : {}), ...(tier ? { tier } : {}), source }));

const NEWS = { labelId: 'newsletter', gmailLabel: 'sift/newsletters' } as const;

describe('suggestions', () => {
  it('are the current decision for each message made while observing, newest first', () => {
    suggest('news@example.com', 'archive', NEWS);
    const second = suggest('news@example.com', 'archive', NEWS);
    recordDecision(
      db,
      ACCOUNT,
      'm2',
      { disposition: 'keep', subscription: 'preserve', stage: 'agent', reason: 'changed its mind', labelId: 'personal' },
      { now: 9 },
    );
    recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'acted' })], '3');
    recordDecision(db, ACCOUNT, 'acted', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r' }, { mode: 'act' });

    const pending = pendingSuggestions(db);
    expect(pending.map((s) => [s.messageId, s.disposition, s.labelId])).toEqual([
      ['m2', 'keep', 'personal'],
      ['m1', 'archive', 'newsletter'],
    ]);
    expect(pending.map((s) => s.decisionId)).not.toContain(second);
  });

  it("leave out what a rule of the user's decided, but not what a rule sift learned did", () => {
    const mine = addRule(db, ACCOUNT, { match: { from: 'rule@example.com' }, labelId: 'newsletter' }, 'user');
    const corrected = addRule(db, ACCOUNT, { match: { from: 'taught@example.com' }, labelId: 'newsletter' }, 'correction');
    const learned = addRule(db, ACCOUNT, { match: { from: 'learned@example.com' }, labelId: 'newsletter' }, 'agent');
    suggest('rule@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: mine });
    suggest('taught@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: corrected });
    suggest('learned@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: learned });
    suggest('gone@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: 'r-removed' });
    expect(pendingSuggestions(db).map((s) => s.fromAddress)).toEqual(['learned@example.com']);
  });

  it('are grouped by sender, showing the commonest guess, biggest first, without kept mail unless asked', () => {
    suggest('a@example.com', 'archive', NEWS);
    suggest('b@example.com', 'archive', NEWS);
    suggest('b@example.com', 'archive', NEWS);
    suggest('b@example.com', 'archive', { labelId: 'marketing' });
    suggest('b@example.com', 'review');
    suggest('c@example.com', 'keep', { labelId: 'personal' });

    const { groups, waiting, labels } = listSuggestions(db);
    expect(waiting).toBe(5);
    expect(groups.map((g) => [g.sender, g.labelName, g.disposition, g.messages, g.guesses])).toEqual([
      ['b@example.com', 'Newsletters', 'archive', 4, 3],
      ['a@example.com', 'Newsletters', 'archive', 1, 1],
    ]);
    expect(groups[0]?.sample.map((m) => m.subject)).toEqual(['Subject m5', 'Subject m4', 'Subject m3', 'Subject m2']);
    expect(labels[ACCOUNT]).toContainEqual({ id: 'newsletter', name: 'Newsletters', disposition: 'archive' });
    expect(listSuggestions(db, { includeKept: true }).waiting).toBe(6);
  });
});

describe('teaching', () => {
  it('agreeing settles everything from the sender and makes a rule: the sender is that label', () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    suggest('other@example.com', 'archive', NEWS);

    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' }, 50);
    expect(result).toEqual({
      reviewed: 2,
      corrected: null,
      taught:
        'From now on, mail from news@example.com is usually Newsletters: archived, and unsubscribed from. sift still reads each one and asks about any that is something else.',
    });
    // Hiding everything from a sender is a prior the model keeps checking, not a blanket.
    expect(ruleFor('news@example.com')).toEqual([{ labelId: 'newsletter', tier: 'usually', source: 'user' }]);
    expect(pendingSuggestions(db).map((s) => s.fromAddress)).toEqual(['other@example.com']);
    expect(accuracy(db)).toMatchObject({ reviewed: 2, right: 2 });
  });

  it('naming a different label corrects sift: the rule comes from the correction and it counts against sift', () => {
    suggest('ada@example.org', 'archive', { labelId: 'marketing' });
    suggest('ada@example.org', 'keep', { labelId: 'personal' });
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'ada@example.org', label: 'personal', scope: 'sender' }, 50);

    expect(result.taught).toBe('From now on, mail from ada@example.org is Personal: kept in your inbox.');
    expect(ruleFor('ada@example.org')).toEqual([{ labelId: 'personal', source: 'correction' }]);
    expect(db.prepare('SELECT verdict, correct, label_id FROM feedback ORDER BY id').all()).toEqual([
      { verdict: 'right', correct: null, label_id: 'personal' },
      { verdict: 'wrong', correct: 'keep', label_id: 'personal' },
    ]);
    expect(accuracy(db)).toMatchObject({ reviewed: 2, right: 1 });
  });

  it('an exception keeps the label but does something else for that sender', () => {
    suggest('digest@example.com', 'archive', NEWS);
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'digest@example.com', label: 'newsletter', disposition: 'keep', scope: 'sender' });
    expect(result.taught).toBe('From now on, mail from digest@example.com is Newsletters: kept in your inbox, and unsubscribed from.');
    expect(ruleFor('digest@example.com')).toEqual([{ labelId: 'newsletter', disposition: 'keep', source: 'user' }]);
    // sift had the label right, so it is not a mistake.
    expect(accuracy(db)).toMatchObject({ reviewed: 1, right: 1 });
  });

  it('answering mail sift could not place teaches the sender without counting as a mistake', () => {
    suggest('cold@example.net', 'review');
    applyFeedback(db, { accountId: ACCOUNT, sender: 'cold@example.net', label: 'marketing', scope: 'sender' });
    expect(db.prepare('SELECT verdict, correct FROM feedback').get()).toEqual({ verdict: 'answered', correct: 'archive' });
    expect(accuracy(db)).toMatchObject({ reviewed: 0, right: 0 });
    expect(ruleFor('cold@example.net')).toEqual([{ labelId: 'marketing', tier: 'usually', source: 'correction' }]);
  });

  it('says so when the label blocks the sender', () => {
    suggest('scam@example.net', 'archive', { labelId: 'marketing' });
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'scam@example.net', label: 'phishing', scope: 'sender' });
    expect(result.taught).toBe('From now on, mail from scam@example.net is Phishing: marked as spam, and the sender blocked.');
    expect(db.prepare('SELECT disposition, label_id FROM examples').get()).toEqual({ disposition: 'spam', label_id: 'phishing' });
  });

  it('an answer about one message is recorded but makes no rule', () => {
    const decisionId = suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'once', decisionId });
    expect(result).toEqual({ reviewed: 1, corrected: null, taught: null });
    expect(listRules(db, ACCOUNT)).toEqual([]);
    expect(pendingSuggestions(db)).toHaveLength(1);
  });

  it("the user's answer replaces a rule sift learned for the sender, and decides later mail without a model", async () => {
    const learned = addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'agent');
    suggest('news@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: learned });
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'sender' });
    expect(listRules(db, ACCOUNT)).toMatchObject([{ id: learned, labelId: 'personal', source: 'correction' }]);
    expect(listRules(db, ACCOUNT)[0]).not.toHaveProperty('learned');

    recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'later' })], '4');
    let modelCalls = 0;
    const model = {
      judge: async () => (modelCalls++, null),
      guidelines: '',
      sources: { api: { getContent: async () => null, getThread: async () => null }, mailbox: { hasSentTo: async () => false } },
    };
    await triageAccount({ db, mailbox: null, model }, listAccounts(db)[0]!);
    expect(db.prepare(`SELECT stage, disposition, label_id FROM decisions WHERE message_id = 'later'`).get()).toEqual({
      stage: 'rules',
      disposition: 'keep',
      label_id: 'personal',
    });
    expect(modelCalls).toBe(0);
    expect(pendingSuggestions(db)).toEqual([]);
  });

  it('rejects a label that does not exist and an answer about nothing that is waiting', () => {
    suggest('news@example.com', 'archive', NEWS);
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'nonsense', scope: 'sender' })).toThrow('no label');
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'nobody@example.com', label: 'newsletter', scope: 'sender' })).toThrow('no longer waiting');
    expect(db.prepare('SELECT count(*) AS n FROM feedback').get()).toEqual({ n: 0 });
    expect(listRules(db, ACCOUNT)).toEqual([]);
  });
});

describe('accuracy', () => {
  it('is reported per tier and per label, with what was mixed up, for answers in the window', () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    suggest('sales@example.com', 'archive', NEWS);
    suggest('shop@example.com', 'archive', { labelId: 'marketing', stage: 'rules' });
    suggest('ada@example.org', 'review');
    const answer = (sender: string, label: string, at: number, messageId?: string) =>
      applyFeedback(db, { accountId: ACCOUNT, sender, label, scope: 'once', ...(messageId ? { messageId } : {}) }, at);
    answer('news@example.com', 'newsletter', 100);
    answer('sales@example.com', 'marketing', 200);
    // Decided by a rule of the user's, so it is not waiting; it is answered by naming the message.
    answer('shop@example.com', 'marketing', 200, 'm4');
    answer('ada@example.org', 'personal', 200);

    expect(accuracy(db)).toEqual({
      reviewed: 4,
      right: 3,
      byStage: [
        { stage: 'agent', reviewed: 3, right: 2 },
        { stage: 'rules', reviewed: 1, right: 1 },
      ],
      byLabel: [
        { labelId: 'newsletter', labelName: 'Newsletters', reviewed: 3, right: 2 },
        { labelId: 'marketing', labelName: 'Marketing', reviewed: 1, right: 1 },
      ],
      confusion: [{ suggested: 'newsletter', correct: 'marketing', count: 1 }],
    });
    expect(accuracy(db, 150)).toMatchObject({ reviewed: 2, right: 1, byLabel: [{ labelId: 'marketing' }, { labelId: 'newsletter', reviewed: 1, right: 0 }] });

    const summary = summarize(db, 7, 200);
    expect(summary.accuracy).toMatchObject({ reviewed: 4, right: 3, confusion: [{ suggested: 'newsletter', correct: 'marketing', count: 1 }] });
    expect(summary.accuracy.byStage).toEqual([
      { stage: 'rules', reviewed: 1, right: 1 },
      { stage: 'sender', reviewed: 0, right: 0 },
      { stage: 'heuristics', reviewed: 0, right: 0 },
      { stage: 'classifier', reviewed: 0, right: 0 },
      { stage: 'agent', reviewed: 3, right: 2 },
      { stage: 'fallback', reviewed: 0, right: 0 },
    ]);
    expect(summarize(db, 7, 200 + 30 * 86_400_000).accuracy).toMatchObject({ reviewed: 0, right: 0, byLabel: [] });
  });
});

describe('correcting a decision that is not waiting', () => {
  /** A message sift already acted on. */
  function acted(address: string, labelId: string) {
    const id = `a${++serial}`;
    recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: id, from: { address, domain: address.split('@')[1] ?? '' }, subject: `Subject ${id}` })],
      '2',
    );
    recordDecision(db, ACCOUNT, id, { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r', labelId }, { mode: 'act', now: serial });
    return id;
  }
  const decisionsFor = (id: string) =>
    db.prepare('SELECT stage, disposition, label_id, mode, outcome, reason FROM decisions WHERE message_id = ? ORDER BY id').all(id);

  it('records what the user said as a new decision, makes the rule, and names the message to put right', () => {
    const id = acted('bids@example.com', 'marketing');
    expect(pendingSuggestions(db)).toEqual([]);
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', label: 'personal', scope: 'sender', messageId: id, mode: 'act' }, 50);
    expect(result).toEqual({ reviewed: 1, corrected: id, taught: 'From now on, mail from bids@example.com is Personal: kept in your inbox.' });
    expect(decisionsFor(id)).toEqual([
      { stage: 'agent', disposition: 'archive', label_id: 'marketing', mode: 'act', outcome: null, reason: 'r' },
      // Waiting to be carried out, which the next pass does once the earlier change has been taken back.
      { stage: 'rules', disposition: 'keep', label_id: 'personal', mode: 'act', outcome: null, reason: 'you said this is Personal' },
    ]);
    expect(ruleFor('bids@example.com')).toEqual([{ labelId: 'personal', source: 'correction' }]);
    expect(db.prepare('SELECT verdict, correct, label_id FROM feedback').get()).toEqual({ verdict: 'wrong', correct: 'keep', label_id: 'personal' });
    expect(db.prepare('SELECT disposition, label_id FROM examples').get()).toEqual({ disposition: 'keep', label_id: 'personal' });
    expect(accuracy(db)).toMatchObject({ reviewed: 1, right: 0 });
  });

  it('can be answered again, and for this message only', () => {
    const id = acted('bids@example.com', 'marketing');
    applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', label: 'personal', scope: 'once', messageId: id });
    expect(listRules(db, ACCOUNT)).toEqual([]);
    expect(applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', label: 'newsletter', scope: 'once', messageId: id })).toMatchObject({
      corrected: id,
      taught: null,
    });
    expect(decisionsFor(id).map((d) => (d as { label_id: string }).label_id)).toEqual(['marketing', 'personal', 'newsletter']);
    // While only observing, the new decision is a record, not something to carry out.
    expect(decisionsFor(id).at(-1)).toMatchObject({ mode: 'observe', outcome: 'observed' });
    expect(pendingSuggestions(db)).toEqual([]);
  });

  it('agreeing with a decision makes the rule and leaves the message alone', () => {
    const id = acted('news@example.com', 'newsletter');
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender', messageId: id, mode: 'act' });
    expect(result).toMatchObject({ reviewed: 1, corrected: null });
    expect(decisionsFor(id)).toHaveLength(1);
    expect(ruleFor('news@example.com')).toEqual([{ labelId: 'newsletter', tier: 'usually', source: 'user' }]);
  });

  it('settles what is waiting from the sender at the same time, and refuses a message from someone else', () => {
    const id = acted('bids@example.com', 'marketing');
    suggest('bids@example.com', 'archive', { labelId: 'marketing' });
    expect(applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', label: 'personal', scope: 'sender', messageId: id })).toMatchObject({
      reviewed: 2,
    });
    expect(pendingSuggestions(db)).toEqual([]);
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'other@example.com', label: 'personal', scope: 'sender', messageId: id })).toThrow(
      'not from that sender',
    );
  });
});

describe('how far an answer reaches', () => {
  const matches = () => listRules(db, ACCOUNT).map((r) => ({ match: r.match, labelId: r.labelId, ...(r.tier ? { tier: r.tier } : {}) }));

  it('a subject answer settles only matching mail and makes a rule that beats a broader one for the sender', async () => {
    recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: 'bid', from: { address: 'bids@example.com', domain: 'example.com' }, subject: 'You have been OUTBID on lot 2' })],
      '2',
    );
    recordDecision(db, ACCOUNT, 'bid', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r', labelId: 'marketing' });
    recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: 'promo', from: { address: 'bids@example.com', domain: 'example.com' }, subject: 'Featured lots' })],
      '3',
    );
    recordDecision(db, ACCOUNT, 'promo', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r', labelId: 'marketing' });

    const answer = { accountId: ACCOUNT, sender: 'bids@example.com', label: 'personal', scope: 'subject' as const };
    expect(() => applyFeedback(db, { ...answer, contains: ' ' })).toThrow('which words');
    expect(() => applyFeedback(db, { ...answer, contains: 'refund' })).toThrow('Nothing waiting from bids@example.com has "refund"');
    expect(applyFeedback(db, { ...answer, contains: 'outbid' })).toEqual({
      reviewed: 1,
      corrected: null,
      taught: 'From now on, mail from bids@example.com with "outbid" in the subject is Personal: kept in your inbox.',
    });
    expect(pendingSuggestions(db).map((s) => s.messageId)).toEqual(['promo']);

    applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', label: 'marketing', scope: 'sender' });
    expect(matches()).toEqual([
      { match: { from: 'bids@example.com', subjectContains: 'outbid' }, labelId: 'personal' },
      { match: { from: 'bids@example.com' }, labelId: 'marketing', tier: 'usually' },
    ]);

    // The narrower rule wins whichever was written first, and not only because it keeps the mail.
    db.prepare(`UPDATE rules SET position = 99 WHERE match_json LIKE '%subjectContains%'`).run();
    db.prepare(`UPDATE labels SET disposition = 'archive' WHERE id = 'personal'`).run();
    recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: 'later', from: { address: 'bids@example.com', domain: 'example.com' }, subject: 'Outbid again' })],
      '4',
    );
    await triageAccount({ db, mailbox: null }, listAccounts(db)[0]!);
    expect(db.prepare(`SELECT label_id FROM decisions WHERE message_id = 'later'`).get()).toEqual({ label_id: 'personal' });
  });

  it('a domain answer settles everyone at the domain and makes a rule for it', () => {
    suggest('a@shop.example', 'archive', { labelId: 'marketing' });
    suggest('b@shop.example', 'review');
    suggest('c@example.com', 'archive', { labelId: 'marketing' });
    expect(applyFeedback(db, { accountId: ACCOUNT, sender: 'a@shop.example', label: 'marketing', scope: 'domain' })).toEqual({
      reviewed: 2,
      corrected: null,
      taught:
        'From now on, mail from anyone at shop.example is usually Marketing: archived, and unsubscribed from. sift still reads each one and asks about any that is something else.',
    });
    expect(matches()).toEqual([{ match: { fromDomain: 'shop.example' }, labelId: 'marketing', tier: 'usually' }]);
    expect(pendingSuggestions(db).map((s) => s.fromAddress)).toEqual(['c@example.com']);
  });

  it('an answer for the waiting mail only settles it all and makes no rule', () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    expect(applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'once' })).toEqual({
      reviewed: 2,
      corrected: null,
      taught: null,
    });
    expect(matches()).toEqual([]);
    expect(db.prepare('SELECT DISTINCT scope FROM feedback').all()).toEqual([{ scope: 'message' }]);
  });
});

describe('reading a suggestion', () => {
  it('holds the text only of mail that is waiting and that sift would move or could not place, and lets it go', async () => {
    suggest('news@example.com', 'archive', NEWS); // m1
    suggest('ada@example.org', 'review'); // m2
    suggest('kept@example.com', 'keep', { labelId: 'personal' }); // m3
    suggest('gone@example.com', 'archive', NEWS); // m4
    const fetched: string[] = [];
    const api = { getBodyText: async (id: string) => (fetched.push(id), id === 'm4' ? null : `Text of ${id}`) };
    const stored = () => db.prepare('SELECT message_id, body_text FROM suggestion_bodies ORDER BY message_id').all();

    expect(await keepSuggestionBodies(db, api, ACCOUNT, () => 1000)).toBe(3);
    expect(stored()).toEqual([
      { message_id: 'm1', body_text: 'Text of m1' },
      { message_id: 'm2', body_text: 'Text of m2' },
      { message_id: 'm4', body_text: '' },
    ]);
    expect(await keepSuggestionBodies(db, api, ACCOUNT, () => 1000)).toBe(0);
    expect(fetched.toSorted()).toEqual(['m1', 'm2', 'm4']);
    expect(messageDetail(db, ACCOUNT, 'm1')?.body).toBe('Text of m1');
    expect(messageDetail(db, ACCOUNT, 'm3')?.body).toBeNull();

    // Answered: the temporary copy goes. (The example keeps the message for good once it is captured.)
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' });
    await keepSuggestionBodies(db, api, ACCOUNT, () => 1000);
    expect(stored().map((r) => (r as { message_id: string }).message_id)).toEqual(['m2', 'm4']);

    // Never answered: it still goes after the limit.
    await keepSuggestionBodies(db, api, ACCOUNT, () => 1000 + (KEEP_BODY_DAYS + 1) * 86_400_000);
    expect(stored()).toEqual([]);
  });

  it("shows one sender's waiting mail with what sift knows about them", () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    suggest('other@example.com', 'archive', NEWS);
    addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'marketing' }, 'user', 5);
    rememberCorrespondent(db, ACCOUNT, 'news@example.com', true);

    const detail = suggestionDetail(db, ACCOUNT, 'news@example.com');
    expect(detail.messages.map((m) => [m.messageId, m.labelName, m.disposition])).toEqual([
      ['m2', 'Newsletters', 'archive'],
      ['m1', 'Newsletters', 'archive'],
    ]);
    expect(detail.sender).toMatchObject({
      address: 'news@example.com',
      messages: 2,
      userHasWritten: true,
      labels: [{ id: 'newsletter', name: 'Newsletters', messages: 2 }],
      rules: [{ match: { fromDomain: 'example.com' }, labelName: 'Marketing', disposition: 'archive', source: 'user' }],
    });
    expect(suggestionDetail(db, ACCOUNT, 'stranger@example.net')).toMatchObject({
      messages: [],
      sender: { messages: 0, userHasWritten: null, labels: [], rules: [] },
    });
  });
});

describe('examples', () => {
  const RAW = Buffer.from('From: News <news@example.com>\r\nSubject: A long\r\n subject line\r\nX-Thing: a: b\r\n\r\nHello there.\r\nFrom: not a header\r\n');

  it('reads every header of a raw message, joining folded lines', () => {
    expect(parseHeaders(RAW)).toEqual([
      ['From', 'News <news@example.com>'],
      ['Subject', 'A long subject line'],
      ['X-Thing', 'a: b'],
    ]);
  });

  it('queues each marked message with the answer and what sift had suggested', () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'keep', { labelId: 'personal' });
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' }, 50);
    expect(db.prepare('SELECT message_id, disposition, label_id, suggested, suggested_by, status, raw FROM examples ORDER BY message_id').all()).toEqual([
      { message_id: 'm1', disposition: 'archive', label_id: 'newsletter', suggested: 'archive', suggested_by: 'agent', status: 'pending', raw: null },
      { message_id: 'm2', disposition: 'archive', label_id: 'newsletter', suggested: 'keep', suggested_by: 'agent', status: 'pending', raw: null },
    ]);
  });

  it('stores the whole message on the next pass, and keeps the answer when the message is gone', async () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' });

    let failing = true;
    const api = {
      getRaw: async (id: string) => {
        if (id === 'm3' && failing) throw new Error('network');
        return id === 'm2' ? null : RAW;
      },
      getBodyText: async () => 'Hello there.',
    };
    await expect(captureExamples(db, api, ACCOUNT, () => 99)).rejects.toThrow('network');
    const stored = db.prepare('SELECT message_id, status, body_text, headers_json, captured_at, length(raw) AS bytes FROM examples ORDER BY message_id').all();
    expect(stored).toEqual([
      { message_id: 'm1', status: 'captured', body_text: 'Hello there.', headers_json: JSON.stringify(parseHeaders(RAW)), captured_at: 99, bytes: RAW.length },
      { message_id: 'm2', status: 'gone', body_text: null, headers_json: null, captured_at: 99, bytes: null },
      { message_id: 'm3', status: 'pending', body_text: null, headers_json: null, captured_at: null, bytes: null },
    ]);

    failing = false;
    expect(await captureExamples(db, api, ACCOUNT)).toBe(1);
    expect(await captureExamples(db, api, ACCOUNT)).toBe(0);
    expect(listSuggestions(db).examples).toEqual({ captured: 2, pending: 0 });
  });
});

describe('feedback endpoint', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  async function start() {
    const assets = mkdtempSync(join(tmpdir(), 'sift-web-'));
    mkdirSync(join(assets, 'assets'));
    writeFileSync(join(assets, 'index.html'), '<!doctype html>');
    const server = createDashboardServer(db, { assetsDir: assets, allowedHosts: ['homebox'], now: () => 77 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => server.close();
    return (server.address() as AddressInfo).port;
  }

  function post(port: number, body: unknown, headers: Record<string, string> = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const req = request(
        {
          port,
          path: '/api/feedback',
          method: 'POST',
          headers: { host: `localhost:${port}`, origin: `http://localhost:${port}`, 'content-type': 'application/json', 'x-sift': '1', ...headers },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += String(chunk)));
          res.on('end', () => {
            let body: Record<string, unknown> = {};
            try {
              body = JSON.parse(data) as Record<string, unknown>;
            } catch {
              body = { text: data };
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.on('error', reject);
      req.end(text);
    });
  }

  const answer = { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' };

  it('records an answer sent by the dashboard page and reports what was learned', async () => {
    suggest('news@example.com', 'archive', NEWS);
    const port = await start();
    expect(await post(port, answer)).toEqual({
      status: 200,
      body: {
        reviewed: 1,
        corrected: null,
        fixed: null,
        taught:
          'From now on, mail from news@example.com is usually Newsletters: archived, and unsubscribed from. sift still reads each one and asks about any that is something else.',
      },
    });
    expect(db.prepare('SELECT created_at FROM feedback').get()).toEqual({ created_at: 77 });
    const suggestions = (await (await fetch(`http://localhost:${port}/api/suggestions`)).json()) as { waiting: number; accuracy: unknown };
    expect(suggestions).toMatchObject({ waiting: 0, accuracy: { reviewed: 1, right: 1 }, examples: { captured: 0, pending: 1 } });
    expect((suggestions as unknown as { labels: Record<string, { id: string }[]> }).labels[ACCOUNT]?.map((l) => l.id)).toContain('newsletter');
  });

  it("accepts the page when it is opened by one of the machine's own names", async () => {
    suggest('news@example.com', 'archive', NEWS);
    const port = await start();
    expect((await post(port, answer, { host: `homebox:${port}`, origin: `http://homebox:${port}` })).status).toBe(200);
  });

  it('refuses a write that did not come from the dashboard page', async () => {
    suggest('news@example.com', 'archive', NEWS);
    const port = await start();
    expect((await post(port, answer, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(port, answer, { origin: '' })).status).toBe(403);
    expect((await post(port, answer, { 'x-sift': '' })).status).toBe(403);
    expect((await post(port, answer, { 'content-type': 'text/plain' })).status).toBe(403);
    expect((await post(port, answer, { host: 'evil.example' })).status).toBe(403);
    expect(db.prepare('SELECT count(*) AS n FROM feedback').get()).toEqual({ n: 0 });
  });

  it('refuses malformed answers and ones about nothing waiting', async () => {
    suggest('news@example.com', 'archive', NEWS);
    const port = await start();
    expect((await post(port, '{not json')).status).toBe(400);
    expect((await post(port, { ...answer, label: undefined })).status).toBe(400);
    expect((await post(port, { ...answer, disposition: 'delete' })).status).toBe(400);
    expect((await post(port, { ...answer, disposition: 'review' })).status).toBe(400);
    expect((await post(port, { ...answer, label: 'DROP TABLE' })).status).toBe(400);
    expect((await post(port, { ...answer, label: 'nonsense' })).status).toBe(409);
    expect((await post(port, { ...answer, scope: 'everyone' })).status).toBe(400);
    expect((await post(port, { ...answer, scope: 'subject' })).status).toBe(400);
    expect((await post(port, { ...answer, filler: 'x'.repeat(20_000) })).status).toBe(400);
    expect((await post(port, { ...answer, sender: 'nobody@example.com' })).status).toBe(409);
    expect((await fetch(`http://localhost:${port}/api/summary`, { method: 'POST' })).status).toBe(405);
  });
});
