import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { KEEP_BODY_DAYS, keepSuggestionBodies } from '../src/daemon/bodies.ts';
import { captureExamples, parseHeaders } from '../src/daemon/examples.ts';
import { triageAccount } from '../src/daemon/triage.ts';
import { listSuggestions, suggestionDetail } from '../src/dashboard/queries/suggestions.ts';
import { messageDetail } from '../src/dashboard/queries/messages.ts';
import { summarize } from '../src/dashboard/queries/summary.ts';
import { people } from '../src/store/people.ts';
import { accuracy, applyFeedback, pendingSuggestions } from '../src/learn/feedback.ts';
import { listAccounts, recordSync } from '../src/store/accounts.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { listProposals } from '../src/store/proposals.ts';
import { addRule, listRules } from '../src/store/rules.ts';
import { rememberCorrespondent } from '../src/store/senders.ts';
import type { Decision, Disposition } from '../src/triage/types.ts';
import { everything, facts, FakeMailbox } from './helpers.ts';
import { raw, startDashboard, onePerson } from './fixtures.ts';
import type { Store } from '../src/store/store.ts';

const ACCOUNT = 'me@example.org';
let db: Sql;
let store: Store;
let serial = 0;

/** Record a message from `address` and what sift would do with it, while observing. */
async function suggest(address: string, disposition: Disposition, extra: Partial<Decision> = {}): Promise<number> {
  const id = `m${++serial}`;
  await recordSync(
    db,
    ACCOUNT,
    [facts({ accountId: ACCOUNT, messageId: id, from: { address, domain: address.split('@')[1] ?? '' }, subject: `Subject ${id}` })],
    '2',
  );
  return await recordDecision(db, ACCOUNT, id, { disposition, subscription: 'preserve', stage: 'agent', reason: 'looks like it', ...extra }, { now: serial });
}

beforeEach(async () => {
  ({ store, db } = await onePerson(ACCOUNT));
  serial = 0;
});

/** The rule sift holds for one sender, without its bookkeeping. */
const ruleFor = async (address: string) =>
  (await listRules(db, ACCOUNT))
    .filter((r) => r.match.from === address)
    .map(({ labelId, whenLabel, disposition, source }) => ({
      ...(labelId ? { labelId } : {}),
      ...(whenLabel ? { whenLabel } : {}),
      ...(disposition ? { disposition } : {}),
      source,
    }));

const NEWS = { labelId: 'newsletter', gmailLabel: 'sift/newsletters' } as const;

describe('suggestions', () => {
  it('are the current decision for each message made while observing, newest first', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    const second = await suggest('news@example.com', 'archive', NEWS);
    await recordDecision(
      db,
      ACCOUNT,
      'm2',
      { disposition: 'keep', subscription: 'preserve', stage: 'agent', reason: 'changed its mind', labelId: 'personal' },
      { now: 9 },
    );
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'acted' })], '3');
    await recordDecision(db, ACCOUNT, 'acted', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r' }, { mode: 'act' });

    const pending = await pendingSuggestions(db);
    expect(pending.map((s) => [s.messageId, s.disposition, s.labelId])).toEqual([
      ['m2', 'keep', 'personal'],
      ['m1', 'archive', 'newsletter'],
    ]);
    expect(pending.map((s) => s.decisionId)).not.toContain(second);
  });

  it("leave out what a rule of the user's decided, but not what a rule sift learned did", async () => {
    const mine = await addRule(db, ACCOUNT, { match: { from: 'rule@example.com' }, labelId: 'newsletter' }, 'user');
    const corrected = await addRule(db, ACCOUNT, { match: { from: 'taught@example.com' }, labelId: 'newsletter' }, 'correction');
    const learned = await addRule(db, ACCOUNT, { match: { from: 'learned@example.com' }, labelId: 'newsletter' }, 'agent');
    await suggest('rule@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: mine });
    await suggest('taught@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: corrected });
    await suggest('learned@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: learned });
    await suggest('gone@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: 'r-removed' });
    expect((await pendingSuggestions(db)).map((s) => s.fromAddress)).toEqual(['learned@example.com']);
  });

  it('are listed one per message, newest first, with the label named, without kept mail unless asked', async () => {
    await suggest('a@example.com', 'archive', NEWS);
    await suggest('b@example.com', 'archive', NEWS);
    await suggest('b@example.com', 'archive', NEWS);
    await suggest('b@example.com', 'archive', { labelId: 'marketing' });
    await suggest('b@example.com', 'review');
    await suggest('c@example.com', 'keep', { labelId: 'personal' });

    const { items, waiting, labels } = await listSuggestions(db, await everything(db));
    expect(waiting).toBe(5);
    expect(items.map((i) => [i.sender, i.subject, i.labelName, i.disposition])).toEqual([
      ['b@example.com', 'Subject m5', null, 'review'],
      ['b@example.com', 'Subject m4', 'Marketing', 'archive'],
      ['b@example.com', 'Subject m3', 'Newsletters', 'archive'],
      ['b@example.com', 'Subject m2', 'Newsletters', 'archive'],
      ['a@example.com', 'Subject m1', 'Newsletters', 'archive'],
    ]);
    // What else it might be: the sender's mail's other labels, most first.
    expect(items[1]?.alternatives).toEqual([{ id: 'newsletter', name: 'Newsletters', share: 2 / 3 }]);
    expect(items[2]?.alternatives).toEqual([{ id: 'marketing', name: 'Marketing', share: 1 / 3 }]);
    expect(labels[ACCOUNT]).toContainEqual({ id: 'newsletter', name: 'Newsletters', disposition: 'archive' });
    expect((await listSuggestions(db, await everything(db), { includeKept: true })).waiting).toBe(6);
  });

  it('carry the start of the text sift holds for each, on one line', async () => {
    await suggest('a@example.com', 'archive', NEWS);
    await suggest('b@example.com', 'archive', NEWS);
    await raw(db).run(
      'INSERT INTO suggestion_bodies (account_id, message_id, body_text, fetched_at) VALUES (?, ?, ?, 0)',
      ACCOUNT,
      'm1',
      'Five stories\n\n  about   widgets.',
    );
    const { items } = await listSuggestions(db, await everything(db));
    expect(items.map((i) => [i.messageId, i.preview])).toEqual([
      ['m2', null],
      ['m1', 'Five stories about widgets.'],
    ]);
  });
});

describe('teaching', () => {
  it('agreeing makes a rule for that kind of mail from the sender, and leaves their other mail waiting', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'keep', { labelId: 'transactional' });
    await suggest('other@example.com', 'archive', NEWS);

    const result = await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'label' }, 50);
    expect(result).toEqual({
      carrying: 0,
      proposed: false,
      reviewed: 2,
      corrected: null,
      taught:
        'From now on, mail from news@example.com that is Newsletters is archived, and unsubscribed from. sift still reads each message, and asks about anything else from them.',
    });
    // The rule waits for each message to be that label; it is not a blanket over the sender.
    expect(await ruleFor('news@example.com')).toEqual([{ whenLabel: 'newsletter', source: 'user' }]);
    expect((await pendingSuggestions(db)).map((s) => [s.fromAddress, s.labelId])).toEqual([
      ['other@example.com', 'newsletter'],
      ['news@example.com', 'transactional'],
    ]);
    expect(await accuracy(db)).toMatchObject({ reviewed: 2, right: 2 });
  });

  it('saying only what a message is corrects sift and teaches by example, with no rule tying the sender to a label', async () => {
    const decisionId = await suggest('ada@example.org', 'archive', { labelId: 'marketing' });
    const result = await applyFeedback(db, { accountId: ACCOUNT, sender: 'ada@example.org', label: 'personal', scope: 'once', decisionId }, 50);

    expect(result).toEqual({ reviewed: 1, corrected: null, taught: null, carrying: 0, proposed: false });
    expect(await listRules(db, ACCOUNT)).toEqual([]);
    expect(await raw(db).all('SELECT verdict, correct, label_id FROM feedback')).toEqual([{ verdict: 'wrong', correct: 'keep', label_id: 'personal' }]);
    // The message itself is what the model is shown next time.
    expect(await raw(db).get('SELECT disposition, label_id, suggested FROM examples')).toEqual({
      disposition: 'keep',
      label_id: 'personal',
      suggested: 'archive',
    });
    expect(await accuracy(db)).toMatchObject({ reviewed: 1, right: 0 });
  });

  it("saying only what should happen to a sender's mail makes a rule that names no label", async () => {
    await suggest('digest@example.com', 'archive', NEWS);
    const result = await applyFeedback(db, { accountId: ACCOUNT, sender: 'digest@example.com', disposition: 'keep', scope: 'sender' });
    expect(result.taught).toBe('From now on, mail from digest@example.com is kept in your inbox, whatever it is. sift will not ask about it again.');
    expect(await ruleFor('digest@example.com')).toEqual([{ disposition: 'keep', source: 'correction' }]);
    // sift would have archived it, so this counts against it; what it said the mail is stands.
    expect(await raw(db).get('SELECT verdict, correct, label_id FROM feedback')).toEqual({ verdict: 'wrong', correct: 'keep', label_id: 'newsletter' });
    expect(await accuracy(db)).toMatchObject({ reviewed: 1, right: 0 });
  });

  it('agreeing with what sift would do for everything from a sender counts for it', async () => {
    await suggest('promo@example.com', 'archive', { labelId: 'marketing' });
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'promo@example.com', disposition: 'archive', scope: 'sender', unsubscribe: true });
    expect(await ruleFor('promo@example.com')).toEqual([{ disposition: 'archive', source: 'user' }]);
    expect((await listRules(db, ACCOUNT))[0]).toMatchObject({ subscription: 'unsubscribe' });
    expect(await accuracy(db)).toMatchObject({ reviewed: 1, right: 1 });
  });

  it('answering mail sift could not place says what happens to it without counting as a mistake or needing a label', async () => {
    await suggest('cold@example.net', 'review');
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'cold@example.net', disposition: 'archive', scope: 'sender' });
    expect(await raw(db).get('SELECT verdict, correct, label_id FROM feedback')).toEqual({ verdict: 'answered', correct: 'archive', label_id: null });
    expect(await accuracy(db)).toMatchObject({ reviewed: 0, right: 0 });
    expect(await ruleFor('cold@example.net')).toEqual([{ disposition: 'archive', source: 'correction' }]);
  });

  it('keeps a relabelled message as an example of the label it was given', async () => {
    const decisionId = await suggest('scam@example.net', 'archive', { labelId: 'marketing' });
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'scam@example.net', label: 'phishing', scope: 'once', decisionId });
    expect(await raw(db).get('SELECT disposition, label_id FROM examples')).toEqual({ disposition: 'spam', label_id: 'phishing' });
  });

  it('an answer about one message is recorded but makes no rule', async () => {
    const decisionId = await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'archive', NEWS);
    const result = await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'once', decisionId });
    expect(result).toEqual({ reviewed: 1, corrected: null, taught: null, carrying: 0, proposed: false });
    expect(await listRules(db, ACCOUNT)).toEqual([]);
    expect(await pendingSuggestions(db)).toHaveLength(1);
  });

  it("the user's answer replaces a rule sift made for the sender, and decides later mail without a model", async () => {
    const learned = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'agent');
    await suggest('news@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: learned });
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', disposition: 'keep', scope: 'sender' });
    expect(await listRules(db, ACCOUNT)).toMatchObject([{ id: learned, disposition: 'keep', source: 'correction' }]);
    expect((await listRules(db, ACCOUNT))[0]).not.toHaveProperty('learned');
    expect((await listRules(db, ACCOUNT))[0]).not.toHaveProperty('labelId');

    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'later' })], '4');
    let modelCalls = 0;
    const model = {
      judge: async () => (modelCalls++, null),
      guidelines: '',
      sources: { api: { getContent: async () => null, getThread: async () => null }, mailbox: { hasSentTo: async () => false } },
    };
    await triageAccount({ db, mailbox: null, model }, (await listAccounts(db))[0]!);
    expect(await raw(db).get(`SELECT stage, disposition, label_id FROM decisions WHERE message_id = 'later'`)).toEqual({
      stage: 'rules',
      disposition: 'keep',
      label_id: null,
    });
    expect(modelCalls).toBe(0);
    expect(await pendingSuggestions(db)).toEqual([]);
  });

  it('rejects a label that does not exist and an answer about nothing that is waiting', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    await expect(applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'nonsense', scope: 'sender' })).rejects.toThrow('no label');
    await expect(applyFeedback(db, { accountId: ACCOUNT, sender: 'nobody@example.com', label: 'newsletter', scope: 'sender' })).rejects.toThrow(
      'no longer waiting',
    );
    expect(await raw(db).get('SELECT count(*) AS n FROM feedback')).toEqual({ n: 0 });
    expect(await listRules(db, ACCOUNT)).toEqual([]);
  });
});

describe('an answer pressed in the dashboard', () => {
  it('is carried out on its message even while sift only observes, and makes no rule', async () => {
    const decisionId = await suggest('news@example.com', 'archive', NEWS);
    // sift's own decision, left over from when it was acting: observing must still leave it alone.
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'left', from: { address: 'other@example.com', domain: 'example.com' } })], '3');
    await recordDecision(db, ACCOUNT, 'left', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'looks like it' }, { mode: 'act' });

    const result = await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'once', decisionId, act: true }, 50);
    expect(result).toMatchObject({ reviewed: 1, carrying: 1, taught: null, proposed: false });
    expect(await ruleFor('news@example.com')).toEqual([]);

    const mailbox = new FakeMailbox();
    mailbox.labels.set('m1', ['INBOX']);
    mailbox.labels.set('left', ['INBOX']);
    await triageAccount({ db, mailbox: null, answers: mailbox }, (await listAccounts(db))[0]!);
    expect(mailbox.labels.get('m1')).not.toContain('INBOX');
    expect(mailbox.labels.get('left')).toEqual(['INBOX']);
    expect(await raw(db).get(`SELECT by_user, mode, outcome FROM decisions WHERE message_id = 'm1' ORDER BY id DESC LIMIT 1`)).toEqual({
      by_user: true,
      mode: 'act',
      outcome: 'done',
    });
  });

  it('three answers in a row the same for a sender propose a rule, and make none themselves', async () => {
    const answers = [];
    for (let i = 0; i < 3; i++) answers.push(await suggest('news@example.com', 'archive', NEWS));
    const said = [];
    for (const [i, decisionId] of answers.entries())
      said.push(await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'once', decisionId, act: true }, 50 + i));
    expect(said.map((r) => r.proposed)).toEqual([false, false, true]);
    expect(await ruleFor('news@example.com')).toEqual([]);
    expect(await listProposals(db, ACCOUNT)).toMatchObject([{ kind: 'rule', match: { from: 'news@example.com' }, labelId: 'newsletter', agreed: 3 }]);
  });
});

describe('accuracy', () => {
  it('is reported per tier and per label, with what was mixed up, for answers in the window', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('sales@example.com', 'archive', NEWS);
    await suggest('shop@example.com', 'archive', { labelId: 'marketing', stage: 'rules' });
    await suggest('ada@example.org', 'review');
    const answer = async (sender: string, label: string, at: number, messageId?: string) =>
      await applyFeedback(db, { accountId: ACCOUNT, sender, label, scope: 'once', ...(messageId ? { messageId } : {}) }, at);
    await answer('news@example.com', 'newsletter', 100);
    await answer('sales@example.com', 'marketing', 200);
    // Decided by a rule of the user's, so it is not waiting; it is answered by naming the message.
    await answer('shop@example.com', 'marketing', 200, 'm4');
    await answer('ada@example.org', 'personal', 200);

    expect(await accuracy(db)).toEqual({
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
    expect(await accuracy(db, 150)).toMatchObject({
      reviewed: 2,
      right: 1,
      byLabel: [{ labelId: 'marketing' }, { labelId: 'newsletter', reviewed: 1, right: 0 }],
    });

    const summary = await summarize(db, await everything(db), 7, 200);
    expect(summary.accuracy).toMatchObject({ reviewed: 4, right: 3, confusion: [{ suggested: 'newsletter', correct: 'marketing', count: 1 }] });
    expect(summary.accuracy.byStage).toEqual([
      { stage: 'rules', reviewed: 1, right: 1 },
      { stage: 'sender', reviewed: 0, right: 0 },
      { stage: 'heuristics', reviewed: 0, right: 0 },
      { stage: 'classifier', reviewed: 0, right: 0 },
      { stage: 'agent', reviewed: 3, right: 2 },
      { stage: 'fallback', reviewed: 0, right: 0 },
    ]);
    expect((await summarize(db, await everything(db), 7, 200 + 30 * 86_400_000)).accuracy).toMatchObject({ reviewed: 0, right: 0, byLabel: [] });
  });
});

describe('correcting a decision that is not waiting', () => {
  /** A message sift already acted on. */
  async function acted(address: string, labelId: string) {
    const id = `a${++serial}`;
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
      { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r', labelId },
      { mode: 'act', now: serial },
    );
    return id;
  }
  const decisionsFor = async (id: string) =>
    await raw(db).all('SELECT stage, disposition, label_id, mode, outcome, reason FROM decisions WHERE message_id = ? ORDER BY id', id);

  it('records what the user said as a new decision, makes the rule, and names the message to put right', async () => {
    const id = await acted('bids@example.com', 'marketing');
    expect(await pendingSuggestions(db)).toEqual([]);
    const result = await applyFeedback(
      db,
      { accountId: ACCOUNT, sender: 'bids@example.com', label: 'personal', scope: 'sender', messageId: id, mode: 'act' },
      50,
    );
    expect(result).toEqual({
      carrying: 0,
      proposed: false,
      reviewed: 1,
      corrected: id,
      taught: 'From now on, mail from bids@example.com is kept in your inbox, whatever it is. sift will not ask about it again.',
    });
    expect(await decisionsFor(id)).toEqual([
      { stage: 'agent', disposition: 'archive', label_id: 'marketing', mode: 'act', outcome: null, reason: 'r' },
      // Waiting to be carried out, which the next pass does once the earlier change has been taken back.
      { stage: 'rules', disposition: 'keep', label_id: 'personal', mode: 'act', outcome: null, reason: 'you said this is Personal' },
    ]);
    // The rule says what happens to their mail; what this message is was corrected on the message alone.
    expect(await ruleFor('bids@example.com')).toEqual([{ disposition: 'keep', source: 'correction' }]);
    expect(await raw(db).get('SELECT verdict, correct, label_id FROM feedback')).toEqual({ verdict: 'wrong', correct: 'keep', label_id: 'personal' });
    expect(await raw(db).get('SELECT disposition, label_id FROM examples')).toEqual({ disposition: 'keep', label_id: 'personal' });
    expect(await accuracy(db)).toMatchObject({ reviewed: 1, right: 0 });
  });

  it('can be answered again, and for this message only', async () => {
    const id = await acted('bids@example.com', 'marketing');
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', label: 'personal', scope: 'once', messageId: id });
    expect(await listRules(db, ACCOUNT)).toEqual([]);
    expect(await applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', label: 'newsletter', scope: 'once', messageId: id })).toMatchObject({
      corrected: id,
      taught: null,
    });
    expect((await decisionsFor(id)).map((d) => (d as { label_id: string }).label_id)).toEqual(['marketing', 'personal', 'newsletter']);
    // While only observing, the new decision is a record, not something to carry out.
    expect((await decisionsFor(id)).at(-1)).toMatchObject({ mode: 'observe', outcome: 'observed' });
    expect(await pendingSuggestions(db)).toEqual([]);
  });

  it('agreeing with a decision makes the rule and leaves the message alone', async () => {
    const id = await acted('news@example.com', 'newsletter');
    const result = await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'label', messageId: id, mode: 'act' });
    expect(result).toMatchObject({ reviewed: 1, corrected: null });
    expect(await decisionsFor(id)).toHaveLength(1);
    expect(await ruleFor('news@example.com')).toEqual([{ whenLabel: 'newsletter', source: 'user' }]);
  });

  it('settles what is waiting from the sender at the same time, and refuses a message from someone else', async () => {
    const id = await acted('bids@example.com', 'marketing');
    await suggest('bids@example.com', 'archive', { labelId: 'marketing' });
    expect(await applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', label: 'personal', scope: 'sender', messageId: id })).toMatchObject({
      reviewed: 2,
    });
    expect(await pendingSuggestions(db)).toEqual([]);
    await expect(applyFeedback(db, { accountId: ACCOUNT, sender: 'other@example.com', label: 'personal', scope: 'sender', messageId: id })).rejects.toThrow(
      'not from that sender',
    );
  });
});

describe('how far an answer reaches', () => {
  const matches = async () =>
    (await listRules(db, ACCOUNT)).map((r) => ({
      match: r.match,
      ...(r.labelId ? { labelId: r.labelId } : {}),
      ...(r.whenLabel ? { whenLabel: r.whenLabel } : {}),
      ...(r.disposition ? { disposition: r.disposition } : {}),
    }));

  it('a subject answer settles only matching mail and makes a rule that beats a broader one for the sender', async () => {
    await recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: 'bid', from: { address: 'bids@example.com', domain: 'example.com' }, subject: 'You have been OUTBID on lot 2' })],
      '2',
    );
    await recordDecision(db, ACCOUNT, 'bid', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r', labelId: 'marketing' });
    await recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: 'promo', from: { address: 'bids@example.com', domain: 'example.com' }, subject: 'Featured lots' })],
      '3',
    );
    await recordDecision(db, ACCOUNT, 'promo', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r', labelId: 'marketing' });

    const answer = { accountId: ACCOUNT, sender: 'bids@example.com', label: 'personal', scope: 'subject' as const };
    await expect(applyFeedback(db, { ...answer, contains: ' ' })).rejects.toThrow('which words');
    await expect(applyFeedback(db, { ...answer, contains: 'refund' })).rejects.toThrow('Nothing waiting from bids@example.com has "refund"');
    expect(await applyFeedback(db, { ...answer, contains: 'outbid' })).toEqual({
      carrying: 0,
      proposed: false,
      reviewed: 1,
      corrected: null,
      taught: 'From now on, mail from bids@example.com with "outbid" in the subject is kept in your inbox, whatever it is. sift will not ask about it again.',
    });
    expect((await pendingSuggestions(db)).map((s) => s.messageId)).toEqual(['promo']);

    await applyFeedback(db, { accountId: ACCOUNT, sender: 'bids@example.com', disposition: 'archive', scope: 'sender' });
    expect(await matches()).toEqual([
      { match: { from: 'bids@example.com', subjectContains: 'outbid' }, disposition: 'keep' },
      { match: { from: 'bids@example.com' }, disposition: 'archive' },
    ]);

    // The narrower rule wins whichever was written first.
    await raw(db).run(`UPDATE rules SET position = 99 WHERE match ->> 'subjectContains' IS NOT NULL`);
    await recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: 'later', from: { address: 'bids@example.com', domain: 'example.com' }, subject: 'Outbid again' })],
      '4',
    );
    await triageAccount({ db, mailbox: null }, (await listAccounts(db))[0]!);
    expect(await raw(db).get(`SELECT disposition, label_id FROM decisions WHERE message_id = 'later'`)).toEqual({ disposition: 'keep', label_id: null });
  });

  it('a domain answer settles everyone at the domain and makes a rule for it', async () => {
    await suggest('a@shop.example', 'archive', { labelId: 'marketing' });
    await suggest('b@shop.example', 'review');
    await suggest('c@example.com', 'archive', { labelId: 'marketing' });
    expect(await applyFeedback(db, { accountId: ACCOUNT, sender: 'a@shop.example', disposition: 'archive', scope: 'domain' })).toEqual({
      carrying: 0,
      proposed: false,
      reviewed: 2,
      corrected: null,
      taught: 'From now on, mail from anyone at shop.example is archived, whatever it is. sift will not ask about it again.',
    });
    expect(await matches()).toEqual([{ match: { fromDomain: 'shop.example' }, disposition: 'archive' }]);
    expect((await pendingSuggestions(db)).map((s) => s.fromAddress)).toEqual(['c@example.com']);
  });

  it('an answer for the waiting mail only settles it all and makes no rule', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'archive', NEWS);
    expect(await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'once' })).toEqual({
      carrying: 0,
      proposed: false,
      reviewed: 2,
      corrected: null,
      taught: null,
    });
    expect(await matches()).toEqual([]);
    expect(await raw(db).all('SELECT DISTINCT scope FROM feedback')).toEqual([{ scope: 'message' }]);
  });
});

describe('reading a suggestion', () => {
  it('holds the text only of mail that is waiting and that sift would move or could not place, and lets it go', async () => {
    await suggest('news@example.com', 'archive', NEWS); // m1
    await suggest('ada@example.org', 'review'); // m2
    await suggest('kept@example.com', 'keep', { labelId: 'personal' }); // m3
    await suggest('gone@example.com', 'archive', NEWS); // m4
    const fetched: string[] = [];
    const api = { getBodyText: async (id: string) => (fetched.push(id), id === 'm4' ? null : `Text of ${id}`) };
    const stored = async () => await raw(db).all('SELECT message_id, body_text FROM suggestion_bodies ORDER BY message_id');

    expect(await keepSuggestionBodies(db, api, ACCOUNT, () => 1000)).toBe(3);
    expect(await stored()).toEqual([
      { message_id: 'm1', body_text: 'Text of m1' },
      { message_id: 'm2', body_text: 'Text of m2' },
      { message_id: 'm4', body_text: '' },
    ]);
    expect(await keepSuggestionBodies(db, api, ACCOUNT, () => 1000)).toBe(0);
    expect(fetched.toSorted()).toEqual(['m1', 'm2', 'm4']);
    expect((await messageDetail(db, await everything(db), ACCOUNT, 'm1'))?.body).toBe('Text of m1');
    expect((await messageDetail(db, await everything(db), ACCOUNT, 'm3'))?.body).toBeNull();

    // Answered: the temporary copy goes. (The example keeps the message for good once it is captured.)
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' });
    await keepSuggestionBodies(db, api, ACCOUNT, () => 1000);
    expect((await stored()).map((r) => (r as { message_id: string }).message_id)).toEqual(['m2', 'm4']);

    // Never answered: it still goes after the limit.
    await keepSuggestionBodies(db, api, ACCOUNT, () => 1000 + (KEEP_BODY_DAYS + 1) * 86_400_000);
    expect(await stored()).toEqual([]);
  });

  it("shows one sender's waiting mail with what sift knows about them", async () => {
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('other@example.com', 'archive', NEWS);
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'marketing' }, 'user', 5);
    await rememberCorrespondent(db, ACCOUNT, 'news@example.com', true);

    const detail = (await suggestionDetail(db, await everything(db), ACCOUNT, 'news@example.com'))!;
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
    expect(await suggestionDetail(db, await everything(db), ACCOUNT, 'stranger@example.net')).toMatchObject({
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

  it('queues each marked message with the answer and what sift had suggested', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'keep', { labelId: 'personal' });
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' }, 50);
    expect(await raw(db).all('SELECT message_id, disposition, label_id, suggested, suggested_by, status, raw FROM examples ORDER BY message_id')).toEqual([
      { message_id: 'm1', disposition: 'archive', label_id: 'newsletter', suggested: 'archive', suggested_by: 'agent', status: 'pending', raw: null },
      { message_id: 'm2', disposition: 'archive', label_id: 'newsletter', suggested: 'keep', suggested_by: 'agent', status: 'pending', raw: null },
    ]);
  });

  it('stores the whole message on the next pass, and keeps the answer when the message is gone', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'archive', NEWS);
    await suggest('news@example.com', 'archive', NEWS);
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' });

    let failing = true;
    const api = {
      getRaw: async (id: string) => {
        if (id === 'm3' && failing) throw new Error('network');
        return id === 'm2' ? null : RAW;
      },
      getBodyText: async () => 'Hello there.',
    };
    await expect(captureExamples(db, api, ACCOUNT, () => 99)).rejects.toThrow('network');
    const stored = await raw(db).all('SELECT message_id, status, body_text, headers, captured_at, length(raw) AS bytes FROM examples ORDER BY message_id');
    expect(stored).toEqual([
      { message_id: 'm1', status: 'captured', body_text: 'Hello there.', headers: parseHeaders(RAW), captured_at: 99, bytes: RAW.length },
      { message_id: 'm2', status: 'gone', body_text: null, headers: null, captured_at: 99, bytes: null },
      { message_id: 'm3', status: 'pending', body_text: null, headers: null, captured_at: null, bytes: null },
    ]);

    failing = false;
    expect(await captureExamples(db, api, ACCOUNT)).toBe(1);
    expect(await captureExamples(db, api, ACCOUNT)).toBe(0);
    expect((await listSuggestions(db, await everything(db))).examples).toEqual({ captured: 2, pending: 0 });
  });
});

describe('feedback endpoint', () => {
  async function start() {
    const { call, port } = await startDashboard(people(store), { allowedHosts: ['homebox'] });
    const post = async (body: unknown, headers?: Record<string, string>) => {
      const { status, body: reply } = await call('POST', '/api/feedback', body, headers);
      return { status, body: reply };
    };
    return { post, port };
  }

  const answer = { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'label' };

  it('records an answer sent by the dashboard page and reports what was learned', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    const { post, port } = await start();
    expect(await post(answer)).toEqual({
      status: 200,
      body: {
        reviewed: 1,
        corrected: null,
        carrying: 1,
        proposed: false,
        fixed: null,
        taught:
          'From now on, mail from news@example.com that is Newsletters is archived, and unsubscribed from. sift still reads each message, and asks about anything else from them.',
      },
    });
    expect(await raw(db).get('SELECT created_at FROM feedback')).toEqual({ created_at: 77 });
    const suggestions = (await (await fetch(`http://localhost:${port}/api/suggestions`)).json()) as { waiting: number; accuracy: unknown };
    expect(suggestions).toMatchObject({ waiting: 0, accuracy: { reviewed: 1, right: 1 }, examples: { captured: 0, pending: 1 } });
    expect((suggestions as unknown as { labels: Record<string, { id: string }[]> }).labels[ACCOUNT]?.map((l) => l.id)).toContain('newsletter');
  });

  it("accepts the page when it is opened by one of the machine's own names", async () => {
    await suggest('news@example.com', 'archive', NEWS);
    const { post, port } = await start();
    expect((await post(answer, { host: `homebox:${port}`, origin: `http://homebox:${port}` })).status).toBe(200);
  });

  it('refuses a write that did not come from the dashboard page', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    const { post } = await start();
    expect((await post(answer, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(answer, { origin: '' })).status).toBe(403);
    expect((await post(answer, { 'x-sift': '' })).status).toBe(403);
    expect((await post(answer, { 'content-type': 'text/plain' })).status).toBe(403);
    expect((await post(answer, { host: 'evil.example' })).status).toBe(403);
    expect(await raw(db).get('SELECT count(*) AS n FROM feedback')).toEqual({ n: 0 });
  });

  it('refuses malformed answers and ones about nothing waiting', async () => {
    await suggest('news@example.com', 'archive', NEWS);
    const { post, port } = await start();
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ ...answer, label: undefined })).status).toBe(400);
    expect((await post({ ...answer, disposition: 'delete' })).status).toBe(400);
    expect((await post({ ...answer, disposition: 'review' })).status).toBe(400);
    expect((await post({ ...answer, label: 'DROP TABLE' })).status).toBe(400);
    expect((await post({ ...answer, label: 'nonsense' })).status).toBe(409);
    expect((await post({ ...answer, scope: 'everyone' })).status).toBe(400);
    expect((await post({ ...answer, scope: 'subject' })).status).toBe(400);
    // An answer says what the mail is, what should happen, or both; a rule for a kind of mail needs the kind.
    const { label: _label, ...unlabelled } = answer;
    expect((await post({ ...unlabelled, scope: 'sender' })).status).toBe(400);
    expect((await post({ ...unlabelled, disposition: 'archive' })).status).toBe(400);
    expect((await post({ ...unlabelled, scope: 'sender', disposition: 'archive' })).status).toBe(200);
    expect((await post({ ...answer, filler: 'x'.repeat(20_000) })).status).toBe(400);
    expect((await post({ ...answer, sender: 'nobody@example.com' })).status).toBe(409);
    expect((await fetch(`http://localhost:${port}/api/summary`, { method: 'POST' })).status).toBe(405);
  });
});
