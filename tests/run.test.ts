import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { type RunOptions, runOnce } from '../src/daemon/run.ts';
import type { GmailApi, RawMessage } from '../src/gmail/api.ts';
import { undo } from '../src/actions/executor.ts';
import { writeRuleFilter } from '../src/actions/rule-filters.ts';
import { applyFeedback } from '../src/learn/feedback.ts';
import { userChanges } from '../src/learn/gmail.ts';
import { lastStandingChange } from '../src/store/actions.ts';
import { addMailbox } from '../src/store/accounts.ts';
import { openUserDb, raw } from './fixtures.ts';
import { updateLabel } from '../src/store/labels.ts';
import { listUndecided } from '../src/store/messages.ts';
import { listProposals, resolveProposal } from '../src/store/proposals.ts';
import { addRule, listRules } from '../src/store/rules.ts';
import { rememberCorrespondent } from '../src/store/senders.ts';
import { FakeMailbox } from './helpers.ts';

const ACCOUNT = 'me@example.org';

function message(id: string, from: string, subject = `Subject ${id}`): RawMessage {
  return {
    id,
    threadId: `t-${id}`,
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: 1000,
    headers: [
      { name: 'From', value: from },
      { name: 'To', value: 'Me <me@example.org>' },
      { name: 'Subject', value: subject },
      { name: 'List-Id', value: '<news.example.com>' },
    ],
  };
}

let db: Sql;
let mailbox: FakeMailbox;
let inbox: RawMessage[];
let logs: string[];
let cursor: number;
let bodies: Map<string, string>;

/** A Gmail with whatever is in `inbox`; each history read hands the messages over once. */
function api(): GmailApi {
  return {
    getProfile: async () => ({ emailAddress: ACCOUNT, historyId: String(cursor) }),
    listHistory: async () => {
      const additions = inbox.map((m) => ({ id: m.id, labelIds: m.labelIds }));
      return { additions, labelChanges: mailbox.history.splice(0), historyId: String(++cursor) };
    },
    searchInbox: async () => ({ ids: [] }),
    getMetadata: async (id) => inbox.find((m) => m.id === id) ?? null,
    getLabelIds: async (id) => mailbox.labels.get(id) ?? null,
    listLabels: async () => [...new Set([...mailbox.labels.values()].flat())].filter((id) => id.startsWith('L:')).map((id) => ({ id, name: id.slice(2) })),
    getBodyText: async (id) => bodies.get(id) ?? null,
    getThread: async () => null,
    getContent: async (id) => (bodies.has(id) ? { text: bodies.get(id)!, facts: { hasAttachments: false } } : null),
    getRaw: async (id) => (bodies.has(id) ? Buffer.from(`Subject: raw ${id}\r\n\r\n${bodies.get(id)}`) : null),
  };
}

/** A model that can place nothing. Mail sift asks about comes from a model's "unsure"; with no model, nothing is asked. */
const unsure = async () => ({ judge: async () => ({ label: 'unsure', reason: 'cannot tell', confidence: 0.2 }) });

const options = (act: boolean): RunOptions => ({ act, connect: () => ({ api: api(), mailbox }), log: (line) => logs.push(line), now: () => 5000 });
const decisions = async () => await raw(db).all('SELECT message_id, stage, disposition, mode, outcome, outcome_detail, rule_id FROM decisions ORDER BY id');

beforeEach(async () => {
  db = await openUserDb();
  await addMailbox(db, ACCOUNT, '1', 0);
  mailbox = new FakeMailbox();
  logs = [];
  cursor = 1;
  bodies = new Map();
  inbox = [message('news', 'News <news@example.com>'), message('ada', 'Ada <ada@example.org>')];
  for (const m of inbox) mailbox.labels.set(m.id, [...m.labelIds]);
});

describe('runOnce', () => {
  it('observes by default: records what it would do and changes nothing', async () => {
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    await runOnce(db, { ...options(false), model: unsure });

    expect(await decisions()).toMatchObject([
      { message_id: 'ada', stage: 'agent', disposition: 'review', mode: 'observe', outcome: 'observed' },
      { message_id: 'news', stage: 'rules', disposition: 'archive', mode: 'observe', outcome: 'observed' },
    ]);
    expect(mailbox.modifyCalls).toBe(0);
    expect(await raw(db).get('SELECT count(*) AS n FROM actions')).toEqual({ n: 0 });
    expect(logs).toEqual([`${ACCOUNT}: 2 new; would archive 1, review 1`]);
  });

  it('acts on decisions, links each action to its decision and counts rule hits', async () => {
    const ruleId = await addRule(db, ACCOUNT, { match: { listId: 'news.example.com', from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    await addRule(db, ACCOUNT, { match: { from: 'ada@example.org' }, labelId: 'personal' }, 'user');
    await runOnce(db, options(true));

    // Both get the label for what they are; only the archived one gets the label for what sift did.
    expect(mailbox.labels.get('news')).toEqual(['UNREAD', 'L:sift/newsletters', 'L:sift/did/archived']);
    expect(mailbox.labels.get('ada')).toEqual(['INBOX', 'UNREAD', 'L:sift/personal']);
    expect(await decisions()).toMatchObject([
      { message_id: 'ada', disposition: 'keep', mode: 'act', outcome: 'done' },
      { message_id: 'news', disposition: 'archive', mode: 'act', outcome: 'done', rule_id: ruleId },
    ]);
    expect(await raw(db).all('SELECT message_id, type, status, decision_id FROM actions ORDER BY message_id')).toEqual([
      { message_id: 'ada', type: 'label', status: 'done', decision_id: 1 },
      { message_id: 'news', type: 'archive', status: 'done', decision_id: 2 },
    ]);
    expect((await listRules(db, ACCOUNT)).map((r) => r.hits)).toEqual([1, 1]);
  });

  it('labels undecided mail for review and leaves it in the inbox', async () => {
    await runOnce(db, { ...options(true), model: unsure });
    expect(mailbox.labels.get('ada')).toEqual(['INBOX', 'UNREAD', 'L:sift/review']);
  });

  it('with no model, leaves what no rule covers in the queue: no decision, no question, nothing changed', async () => {
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    await runOnce(db, options(true));
    expect(await decisions()).toMatchObject([{ message_id: 'news' }]);
    expect(await decisions()).toHaveLength(1);
    expect((await listUndecided(db, ACCOUNT, 10)).map((m) => m.facts.messageId)).toEqual(['ada']);
    expect(mailbox.labels.get('ada')).toEqual(['INBOX', 'UNREAD']);
    expect(logs).toEqual([`${ACCOUNT}: 2 new; decided archive 1; 1 changed`]);
  });

  it('decides each message once, however many passes run', async () => {
    await runOnce(db, { ...options(true), model: unsure });
    await runOnce(db, { ...options(true), model: unsure });
    expect(await decisions()).toHaveLength(2);
    expect(mailbox.modifyCalls).toBe(2);
    expect(logs).toHaveLength(1);
  });

  it('records why a decision was not carried out', async () => {
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'marketing', disposition: 'spam' }, 'user');
    mailbox.sentTo.add('news@example.com');
    mailbox.labels.set('ada', ['UNREAD']);
    await runOnce(db, { ...options(true), model: unsure });

    expect(await decisions()).toMatchObject([
      { message_id: 'ada', outcome: 'skipped', outcome_detail: 'message is not in the inbox' },
      { message_id: 'news', disposition: 'spam', outcome: 'skipped', outcome_detail: 'you have written to this sender, so spam is refused' },
    ]);
    expect(mailbox.modifyCalls).toBe(0);
  });

  it('says when the failure is an expired Google sign-in, which no retry fixes', async () => {
    const [failed] = await runOnce(db, {
      ...options(false),
      connect: () => {
        throw new Error('invalid_grant');
      },
    });
    expect(failed).toMatchObject({ error: 'invalid_grant', expired: true });
    expect(logs).toEqual([expect.stringContaining('Google sign-in has expired')]);

    const [other] = await runOnce(db, {
      ...options(false),
      connect: () => {
        throw new Error('network down');
      },
    });
    expect(other?.expired).toBeUndefined();
  });

  it('keeps a decision it could not carry out and retries it on the next pass', async () => {
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    inbox = [inbox[0]!];
    mailbox.failReads = true;
    const [failed] = await runOnce(db, options(true));
    expect(failed?.error).toBe('network down');
    expect(await decisions()).toMatchObject([{ message_id: 'news', mode: 'act', outcome: null }]);

    mailbox.failReads = false;
    inbox = [];
    await runOnce(db, options(true));
    expect(await decisions()).toMatchObject([{ message_id: 'news', outcome: 'done' }]);
    expect(mailbox.labels.get('news')).toEqual(['UNREAD', 'L:sift/newsletters', 'L:sift/did/archived']);
  });
});

describe('teaching from Gmail', () => {
  const feedback = async () => await raw(db).all('SELECT message_id, verdict, correct, scope, label_id, via FROM feedback ORDER BY id');
  const latest = async (id: string) =>
    await raw(db).get('SELECT stage, disposition, label_id, mode, rule_id, reason FROM decisions WHERE message_id = ? ORDER BY id DESC LIMIT 1', id);
  const count = async (table: string) => (await raw(db).get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))!.n;
  // Time moves between passes: which of its own changes sift expects in a history depends on when they were made.
  let clock: number;
  const run = async (act: boolean) => {
    const [result] = await runOnce(db, { ...options(act), now: () => clock });
    clock += 1000;
    expect(result?.error).toBeUndefined();
    return result?.sync?.corrections;
  };
  const pass = (act: boolean) => {
    inbox = [];
    return run(act);
  };

  beforeEach(async () => {
    clock = 5000;
    await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    await addRule(db, ACCOUNT, { match: { from: 'ada@example.org' }, labelId: 'personal' }, 'user');
  });

  it('takes mail moved back to the inbox as an answer for that message, makes no rule and changes nothing in Gmail', async () => {
    await run(true);
    expect(mailbox.labels.get('news')).not.toContain('INBOX');
    mailbox.byUser('news', { add: ['INBOX'] });
    const calls = mailbox.modifyCalls;

    expect(await pass(true)).toBe(1);
    // The move does not say what the mail is, so the label stands and the outcome is the exception.
    expect(await feedback()).toEqual([{ message_id: 'news', verdict: 'right', correct: null, scope: 'message', label_id: 'newsletter', via: 'gmail' }]);
    expect(await latest('news')).toEqual({
      stage: 'rules',
      disposition: 'keep',
      label_id: 'newsletter',
      mode: 'observe',
      rule_id: null,
      reason: 'you said this is Newsletters',
    });
    expect(await raw(db).all('SELECT message_id, disposition, suggested FROM examples')).toEqual([
      { message_id: 'news', disposition: 'keep', suggested: 'archive' },
    ]);
    expect(await listRules(db, ACCOUNT)).toHaveLength(2);
    expect(mailbox.modifyCalls).toBe(calls);
    expect(logs.at(-1)).toMatch(/learned from 1 message you moved or relabelled in Gmail/);
  });

  it('records the same history only once when it is delivered again', async () => {
    await run(true);
    mailbox.byUser('news', { add: ['INBOX'] });
    const again = [...mailbox.history];
    expect(await pass(true)).toBe(1);
    const before = [await count('decisions'), await count('feedback'), await count('actions')];

    mailbox.history.push(...again);
    expect(await pass(true)).toBe(0);
    expect([await count('decisions'), await count('feedback'), await count('actions')]).toEqual(before);
  });

  it('takes mail out of spam, archived or marked as spam by the user as answers too', async () => {
    await updateLabel(db, ACCOUNT, 'newsletter', { disposition: 'spam' });
    await run(true);
    expect(mailbox.labels.get('news')).toContain('SPAM');

    mailbox.byUser('news', { add: ['INBOX'], remove: ['SPAM'] });
    mailbox.byUser('ada', { remove: ['INBOX'] });
    expect(await pass(true)).toBe(2);
    expect(await latest('news')).toMatchObject({ disposition: 'keep', label_id: 'newsletter' });
    expect(await latest('ada')).toMatchObject({ disposition: 'archive', label_id: 'personal' });

    mailbox.byUser('ada', { add: ['SPAM'] });
    expect(await pass(true)).toBe(1);
    expect(await latest('ada')).toMatchObject({ disposition: 'spam', label_id: 'personal' });
    // The user's answers are not carried out again by sift.
    expect(mailbox.labels.get('ada')).toEqual(['UNREAD', 'L:sift/personal', 'SPAM']);
  });

  it('takes a different sift label as a correction of what the mail is, wherever the message was left', async () => {
    await run(true);
    mailbox.byUser('news', { remove: ['L:sift/newsletters'], add: ['L:sift/receipts'] });
    expect(await pass(true)).toBe(1);
    expect(await feedback()).toEqual([{ message_id: 'news', verdict: 'wrong', correct: 'archive', scope: 'message', label_id: 'transactional', via: 'gmail' }]);
    // Receipts are kept, but the user left this one archived.
    expect(await latest('news')).toMatchObject({ disposition: 'archive', label_id: 'transactional', rule_id: null });
    expect(mailbox.labels.get('news')).not.toContain('INBOX');
  });

  it("ignores labels that are not sift's, stars, and messages that are gone or in the trash", async () => {
    await run(true);
    mailbox.byUser('news', { add: ['L:travel', 'STARRED'] });
    mailbox.byUser('ada', { remove: ['INBOX'], add: ['TRASH'] });
    mailbox.history.push({ messageId: 'never-seen', added: ['INBOX'], removed: [] });
    expect(await pass(true)).toBe(0);

    mailbox.byUser('news', { add: ['INBOX'] });
    mailbox.labels.delete('news');
    expect(await pass(true)).toBe(0);
    expect(await feedback()).toEqual([]);
  });

  it("does not mistake sift's own changes for the user's: acting, undoing, and putting right after an answer in the dashboard", async () => {
    await run(true);
    expect(await pass(true)).toBe(0);

    await undo({ db, mailbox, now: () => clock }, (await lastStandingChange(db, ACCOUNT, 'news'))!.id);
    expect(mailbox.labels.get('news')).toContain('INBOX');
    expect(await pass(true)).toBe(0);

    await applyFeedback(db, { accountId: ACCOUNT, sender: 'ada@example.org', label: 'newsletter', scope: 'sender', messageId: 'ada', mode: 'act' });
    await undo({ db, mailbox, now: () => clock }, (await lastStandingChange(db, ACCOUNT, 'ada'))!.id);
    expect(await pass(true)).toBe(0);
    expect(mailbox.labels.get('ada')).not.toContain('INBOX');
    expect(await pass(true)).toBe(0);
    expect(await raw(db).get(`SELECT count(*) AS n FROM feedback WHERE via = 'gmail'`)).toEqual({ n: 0 });
  });

  it('tells the user moving mail back from sift archiving it, when both are in the same history', async () => {
    await run(true);
    await undo({ db, mailbox, now: () => clock }, (await lastStandingChange(db, ACCOUNT, 'news'))!.id);
    clock += 1;
    // sift put it back in the inbox, and then the user archived it by hand.
    mailbox.byUser('news', { remove: ['INBOX'] });
    mailbox.byUser('news', { add: ['INBOX'] });
    mailbox.byUser('news', { remove: ['INBOX'] });
    expect(await pass(true)).toBe(0);

    mailbox.byUser('news', { add: ['INBOX'] });
    expect(await pass(true)).toBe(1);
    expect(await latest('news')).toMatchObject({ disposition: 'keep' });
  });

  it('while observing, counts the user doing what sift suggested as agreement, and doing otherwise as the answer', async () => {
    await raw(db).run(`UPDATE rules SET source = 'agent'`);
    await run(false);
    mailbox.byUser('news', { remove: ['INBOX'] });
    mailbox.byUser('ada', { remove: ['INBOX'] });
    const again = [...mailbox.history];
    expect(await pass(false)).toBe(2);
    expect(await feedback()).toEqual([
      { message_id: 'news', verdict: 'right', correct: null, scope: 'message', label_id: 'newsletter', via: 'gmail' },
      { message_id: 'ada', verdict: 'right', correct: null, scope: 'message', label_id: 'personal', via: 'gmail' },
    ]);
    expect(await raw(db).all('SELECT message_id, disposition, suggested FROM examples ORDER BY message_id')).toEqual([
      { message_id: 'ada', disposition: 'archive', suggested: 'keep' },
      { message_id: 'news', disposition: 'archive', suggested: 'archive' },
    ]);

    mailbox.history.push(...again);
    expect(await pass(false)).toBe(0);
    expect(await count('feedback')).toBe(2);
    expect(await count('decisions')).toBe(2);
  });

  it('skips mail sift could not place unless the user gave it a sift label', async () => {
    await raw(db).run('DELETE FROM rules');
    await runOnce(db, { ...options(true), now: () => clock, model: unsure });
    clock += 1000;
    expect(await latest('news')).toMatchObject({ disposition: 'review', label_id: null });
    mailbox.byUser('news', { remove: ['INBOX'] });
    expect(await pass(true)).toBe(0);

    mailbox.byUser('ada', { add: ['L:sift/personal'] });
    expect(await pass(true)).toBe(1);
    expect(await latest('ada')).toMatchObject({ disposition: 'keep', label_id: 'personal', rule_id: null });
    expect(await feedback()).toEqual([{ message_id: 'ada', verdict: 'answered', correct: 'keep', scope: 'message', label_id: 'personal', via: 'gmail' }]);
  });
});

describe('telling the user from sift in history', () => {
  const act = async (messageId: string, payload: { add: string[]; remove: string[] }, status: string, at: number) =>
    await raw(db).run(
      `INSERT INTO actions (account_id, message_id, type, payload, original_labels, status, created_at) VALUES (?, ?, 'archive', ?, '[]', ?, ?)`,
      ACCOUNT,
      messageId,
      JSON.stringify(payload),
      status,
      at,
    );

  it('cancels each of its own changes since the last sync against one entry, and leaves the rest', async () => {
    await act('a', { add: ['L1'], remove: ['INBOX', 'UNREAD'] }, 'done', 200);
    await act('b', { add: [], remove: ['INBOX'] }, 'unknown', 200);
    await act('c', { add: [], remove: ['INBOX'] }, 'failed', 200);
    await act('d', { add: [], remove: ['INBOX'] }, 'done', 99);
    const history = [
      { messageId: 'a', added: ['L1'], removed: [] },
      { messageId: 'a', added: [], removed: ['INBOX', 'UNREAD'] },
      { messageId: 'a', added: ['INBOX'], removed: [] },
      { messageId: 'a', added: [], removed: ['INBOX'] },
      { messageId: 'b', added: [], removed: ['INBOX'] },
      { messageId: 'c', added: [], removed: ['INBOX'] },
      { messageId: 'd', added: [], removed: ['INBOX'] },
      { messageId: 'e', added: ['STARRED'], removed: ['UNREAD'] },
    ];
    expect(await userChanges(db, ACCOUNT, history, 100)).toEqual([
      { messageId: 'a', added: ['INBOX'], removed: ['INBOX'] },
      { messageId: 'c', added: [], removed: ['INBOX'] },
      { messageId: 'd', added: [], removed: ['INBOX'] },
      { messageId: 'e', added: ['STARRED'], removed: ['UNREAD'] },
    ]);
    expect(await userChanges(db, ACCOUNT, [], 0)).toEqual([]);
  });
});

describe('read state', () => {
  const readAt = async (id: string) => (await raw(db).get<{ read_at: number | null }>('SELECT read_at FROM messages WHERE id = ?', id))!.read_at;

  it('records when the user opened a message, and not when sift marked it read', async () => {
    await updateLabel(db, ACCOUNT, 'newsletter', { markRead: true });
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    await runOnce(db, options(true));
    expect(mailbox.labels.get('news')).not.toContain('UNREAD');

    inbox = [];
    mailbox.byUser('ada', { remove: ['UNREAD'] });
    await runOnce(db, { ...options(true), now: () => 6000 });
    expect(await readAt('news')).toBeNull();
    expect(await readAt('ada')).toBe(6000);
  });

  it('still sees the user open a message sift marked read, undid, and that they then read themselves', async () => {
    await updateLabel(db, ACCOUNT, 'newsletter', { markRead: true });
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    await runOnce(db, options(true));
    await undo({ db, mailbox, now: () => 5000 }, (await lastStandingChange(db, ACCOUNT, 'news'))!.id);
    mailbox.byUser('news', { remove: ['UNREAD'] });
    inbox = [];
    await runOnce(db, { ...options(true), now: () => 6000 });
    expect(await readAt('news')).toBe(6000);
  });
});

describe('Gmail filters', () => {
  it('are checked during a pass, and a Gmail that cannot list them does not fail it', async () => {
    const id = await addRule(db, ACCOUNT, { match: { from: 'ada@example.org' }, labelId: 'personal' }, 'user');
    await writeRuleFilter({ db, mailbox }, id);
    mailbox.filters = [];
    mailbox.failFilters = true;
    const [failed] = await runOnce(db, options(false));
    expect(failed?.error).toBeUndefined();
    expect(logs.join('\n')).toMatch(/could not check Gmail filters: network down/);

    mailbox.failFilters = false;
    const [result] = await runOnce(db, options(false));
    expect(result?.filters).toEqual({ gone: 1, changed: 0, outdated: 0 });
    expect(logs.at(-1)).toMatch(/1 filter deleted in Gmail/);
    expect(await raw(db).get('SELECT filter_id, filter_state FROM rules WHERE id = ?', id)).toEqual({ filter_id: null, filter_state: 'gone' });
  });
});

describe('triage queue', () => {
  it('rebuilds triage input from the database without refetching', async () => {
    await runOnce(db, {
      ...options(false),
      connect: () => ({ api: { ...api(), listHistory: async () => ({ additions: [{ id: 'news', labelIds: ['INBOX'] }], historyId: '9' }) }, mailbox }),
    });
    await raw(db).run('DELETE FROM decisions');
    expect((await listUndecided(db, ACCOUNT, 10)).map((queued) => queued.facts)).toEqual([
      {
        accountId: ACCOUNT,
        messageId: 'news',
        threadId: 't-news',
        from: { address: 'news@example.com', domain: 'example.com', name: 'News' },
        to: [{ address: 'me@example.org', domain: 'example.org', name: 'Me' }],
        cc: [],
        subject: 'Subject news',
        labelIds: ['INBOX', 'UNREAD'],
        headers: { from: 'News <news@example.com>', to: 'Me <me@example.org>', subject: 'Subject news', 'list-id': '<news.example.com>' },
        receivedAt: 1000,
      },
    ]);
  });
});

describe('inference tier', () => {
  const judged: string[] = [];
  const model = (label: string) => async () => ({
    judge: async ({ evidence }: { evidence: { facts: { messageId: string } } }) => {
      judged.push(evidence.facts.messageId);
      return { label, reason: 'looks like a mailing', confidence: 0.9, usage: { model: 'test/model', inputTokens: 800, outputTokens: 20, costUsd: 0.002 } };
    },
  });

  it('classifies what no rule covers, does what the label says and records the cost', async () => {
    judged.length = 0;
    inbox = [inbox[0]!];
    await runOnce(db, { ...options(true), model: model('newsletter') });

    expect(await raw(db).get('SELECT stage, disposition, label_id, gmail_label, model, cost_usd, outcome FROM decisions')).toEqual({
      stage: 'agent',
      disposition: 'archive',
      label_id: 'newsletter',
      gmail_label: 'sift/newsletters',
      model: 'test/model',
      cost_usd: 0.002,
      outcome: 'done',
    });
    expect(mailbox.labels.get('news')).toEqual(['UNREAD', 'L:sift/newsletters', 'L:sift/did/archived']);
  });

  it('proposes a rule for a sender the model keeps labelling the same way, and keeps judging until it is accepted', async () => {
    judged.length = 0;
    const arrive = async (id: string) => {
      inbox = [message(id, 'News <news@example.com>')];
      mailbox.labels.set(id, ['INBOX']);
      await runOnce(db, { ...options(true), model: model('newsletter') });
    };
    for (const id of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']) await arrive(id);
    expect(judged).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    expect(await listRules(db, ACCOUNT)).toEqual([]);
    expect(logs.some((line) => line.includes('proposed 1 rule'))).toBe(true);

    await resolveProposal(db, (await listProposals(db, ACCOUNT))[0]!.id, true);
    await arrive('n7');
    expect(judged).not.toContain('n7');
    expect(await raw(db).get(`SELECT stage, disposition, label_id, reason FROM decisions WHERE message_id = 'n7'`)).toEqual({
      stage: 'rules',
      disposition: 'archive',
      label_id: 'newsletter',
      reason: 'rule: from news@example.com is Newsletters',
    });
  });

  it('archives what an action rule covers without asking the model or naming a label', async () => {
    judged.length = 0;
    const ruleId = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, disposition: 'archive' }, 'user');
    inbox = [message('g1', 'News <news@example.com>')];
    mailbox.labels.set('g1', ['INBOX', 'UNREAD']);
    await runOnce(db, { ...options(true), model: model('newsletter') });
    expect(judged).toEqual([]);
    expect(await raw(db).get(`SELECT stage, disposition, label_id, gmail_label, rule_id, reason FROM decisions WHERE message_id = 'g1'`)).toEqual({
      stage: 'rules',
      disposition: 'archive',
      label_id: null,
      gmail_label: null,
      rule_id: ruleId,
      reason: 'rule: from news@example.com: archive it',
    });
    // Out of the inbox, marked as sift's doing, and given no label of what it is.
    expect(mailbox.labels.get('g1')).toEqual(['UNREAD', 'L:sift/did/archived']);
  });

  it('applies a rule that waits for a label only to mail the model gives that label, and asks about the rest', async () => {
    judged.length = 0;
    const ruleId = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, whenLabel: 'newsletter' }, 'user');
    inbox = [message('u1', 'News <news@example.com>')];
    mailbox.labels.set('u1', ['INBOX']);
    await runOnce(db, { ...options(true), model: model('newsletter') });
    expect(judged).toEqual(['u1']);
    expect(await raw(db).get(`SELECT stage, disposition, rule_id, prior_rule_id, reason FROM decisions WHERE message_id = 'u1'`)).toEqual({
      stage: 'agent',
      disposition: 'archive',
      rule_id: ruleId,
      prior_rule_id: ruleId,
      reason: 'rule: from news@example.com, when it is Newsletters. Newsletters: looks like a mailing',
    });

    inbox = [message('u2', 'News <news@example.com>')];
    mailbox.labels.set('u2', ['INBOX']);
    await runOnce(db, { ...options(true), model: model('transactional') });
    expect(await raw(db).get(`SELECT disposition, label_id, rule_id, prior_rule_id, reason FROM decisions WHERE message_id = 'u2'`)).toEqual({
      disposition: 'keep',
      label_id: 'transactional',
      rule_id: null,
      prior_rule_id: ruleId,
      reason: 'not the usual Newsletters. Receipts and transactions: looks like a mailing',
    });
    expect(mailbox.labels.get('u2')).toContain('INBOX');
  });

  it('gathers evidence and classifies in observe mode without changing the mailbox', async () => {
    judged.length = 0;
    inbox = [inbox[0]!];
    await runOnce(db, { ...options(false), model: model('marketing') });
    expect(judged).toEqual(['news']);
    expect(await raw(db).get('SELECT disposition, mode, outcome FROM decisions')).toEqual({ disposition: 'archive', mode: 'observe', outcome: 'observed' });
    expect(mailbox.modifyCalls).toBe(0);
  });
});

describe('unsubscribing', () => {
  const asked: string[] = [];
  const withUnsubscribe = (act: boolean, result: 'done' | 'refused' = 'done'): RunOptions => ({
    ...options(act),
    unsubscribe: async (_db, _account, messageId) => {
      asked.push(messageId);
      return result === 'done' ? { status: 'done', actionId: 1 } : { status: 'refused', reason: 'no way to' };
    },
  });

  it('follows the mailbox change for a label that unsubscribes, and only while acting', async () => {
    asked.length = 0;
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    inbox = [inbox[0]!];
    await runOnce(db, withUnsubscribe(false));
    expect(asked).toEqual([]);
    expect(await raw(db).get('SELECT subscription FROM decisions')).toEqual({ subscription: 'unsubscribe' });

    await raw(db).run('DELETE FROM decisions');
    await runOnce(db, withUnsubscribe(true));
    expect(asked).toEqual(['news']);
    expect(mailbox.labels.get('news')).toContain('L:sift/did/archived');
    expect(logs.at(-1)).toContain('unsubscribed from 1 sender');
  });

  it('can be asked for by a rule whose label does not, and is not counted when it could not be done', async () => {
    asked.length = 0;
    await addRule(db, ACCOUNT, { match: { from: 'ada@example.org' }, labelId: 'notification', subscription: 'unsubscribe', markRead: true }, 'user');
    inbox = [inbox[1]!];
    await runOnce(db, withUnsubscribe(true, 'refused'));
    expect(asked).toEqual(['ada']);
    // Kept, labelled, and marked read as the rule asks.
    expect(mailbox.labels.get('ada')).toEqual(['INBOX', 'L:sift/notifications']);
    expect(logs.at(-1)).not.toContain('unsubscribed');
  });

  it('never unsubscribes from someone the user has written to, or when the mailbox change did not happen', async () => {
    asked.length = 0;
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    await rememberCorrespondent(db, ACCOUNT, 'news@example.com', true);
    inbox = [inbox[0]!];
    await runOnce(db, withUnsubscribe(true));
    expect(mailbox.labels.get('news')).toContain('L:sift/did/archived');
    expect(asked).toEqual([]);

    await raw(db).run('DELETE FROM actions');
    await raw(db).run('DELETE FROM decisions');
    await raw(db).run('DELETE FROM correspondents');
    mailbox.labels.set('news', ['UNREAD']);
    await runOnce(db, withUnsubscribe(true));
    expect(await raw(db).get('SELECT outcome FROM decisions')).toEqual({ outcome: 'skipped' });
    expect(asked).toEqual([]);
  });
});

describe('correcting what sift did', () => {
  it('takes the change back and carries out what the user said instead', async () => {
    await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'agent');
    inbox = [inbox[0]!];
    await runOnce(db, options(true));
    expect(mailbox.labels.get('news')).toEqual(['UNREAD', 'L:sift/newsletters', 'L:sift/did/archived']);

    const result = await applyFeedback(db, {
      accountId: ACCOUNT,
      sender: 'news@example.com',
      label: 'personal',
      scope: 'sender',
      messageId: 'news',
      mode: 'act',
    });
    expect(result.corrected).toBe('news');
    // What the dashboard asks the running sift to do next.
    const last = await lastStandingChange(db, ACCOUNT, 'news');
    await undo({ db, mailbox }, last!.id);
    expect(mailbox.labels.get('news')?.toSorted()).toEqual(['INBOX', 'UNREAD']);

    inbox = [];
    await runOnce(db, options(true));
    expect(mailbox.labels.get('news')?.toSorted()).toEqual(['INBOX', 'L:sift/personal', 'UNREAD']);
    expect(await raw(db).get(`SELECT disposition, outcome FROM decisions WHERE message_id = 'news' ORDER BY id DESC LIMIT 1`)).toEqual({
      disposition: 'keep',
      outcome: 'done',
    });
    expect(await lastStandingChange(db, ACCOUNT, 'news')).toMatchObject({ type: 'label' });
  });
});

describe('blocking', () => {
  const phish = (id: string, authenticated: boolean): RawMessage => {
    const m = message(id, 'Bank <alerts@example.net>', 'Verify your account');
    return { ...m, headers: [...m.headers, { name: 'Authentication-Results', value: `mx.example.org; dmarc=${authenticated ? 'pass' : 'fail'}` }] };
  };
  const phishing = async () => ({ judge: async () => ({ label: 'phishing', reason: 'asks for a password' }) });

  it('marks the message spam and makes a rule for the sender, so their later mail needs no model', async () => {
    inbox = [phish('p1', true)];
    mailbox.labels.set('p1', ['INBOX']);
    await runOnce(db, { ...options(true), model: phishing });
    expect(mailbox.labels.get('p1')).toEqual(['L:sift/phishing', 'L:sift/did/spam', 'SPAM']);
    expect(await listRules(db, ACCOUNT)).toMatchObject([{ match: { from: 'alerts@example.net' }, labelId: 'phishing', source: 'agent' }]);
    expect(logs.at(-1)).toContain('blocked 1 sender');

    let asked = 0;
    inbox = [phish('p2', true)];
    mailbox.labels.set('p2', ['INBOX']);
    await runOnce(db, { ...options(true), model: async () => ({ judge: async () => (asked++, null) }) });
    expect(asked).toBe(0);
    expect(await raw(db).get(`SELECT stage, disposition, block FROM decisions WHERE message_id = 'p2'`)).toEqual({
      stage: 'rules',
      disposition: 'spam',
      block: true,
    });
  });

  it('does not block a sender whose message did not prove who sent it, or while only observing', async () => {
    inbox = [phish('p1', false)];
    mailbox.labels.set('p1', ['INBOX']);
    await runOnce(db, { ...options(true), model: phishing });
    expect(mailbox.labels.get('p1')).toContain('SPAM');
    expect(await listRules(db, ACCOUNT)).toEqual([]);

    inbox = [phish('p2', true)];
    mailbox.labels.set('p2', ['INBOX']);
    await runOnce(db, { ...options(false), model: phishing });
    expect(await listRules(db, ACCOUNT)).toEqual([]);
  });

  it('holds mail from someone the user has written to for review instead, and blocks nobody', async () => {
    mailbox.sentTo.add('alerts@example.net');
    inbox = [phish('p1', true)];
    mailbox.labels.set('p1', ['INBOX']);
    await runOnce(db, { ...options(true), model: phishing });
    expect(mailbox.labels.get('p1')).toEqual(['INBOX', 'L:sift/phishing', 'L:sift/review']);
    expect(await listRules(db, ACCOUNT)).toEqual([]);
  });
});

describe('examples', () => {
  it('stores marked messages whole on the next pass, while only observing', async () => {
    inbox = [inbox[0]!];
    bodies.set('news', 'The full text of the newsletter.');
    await runOnce(db, { ...options(false), model: async () => ({ judge: async () => ({ label: 'newsletter', reason: 'r' }) }) });
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' });

    inbox = [];
    const [result] = await runOnce(db, options(false));
    expect(result?.captured).toBe(1);
    expect(logs.at(-1)).toContain('stored 1 marked message as examples');
    const example = (await raw(db).get<{ raw: Uint8Array; body_text: string }>('SELECT label_id, disposition, body_text, raw FROM examples'))!;
    expect(example).toMatchObject({ label_id: 'newsletter', disposition: 'archive', body_text: 'The full text of the newsletter.' });
    expect(Buffer.from(example.raw).toString()).toContain('The full text of the newsletter.');
    expect(mailbox.modifyCalls).toBe(0);
  });
});
