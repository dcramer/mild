import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type RunOptions, runOnce } from '../src/daemon/run.ts';
import type { GmailApi, RawMessage } from '../src/gmail/api.ts';
import { applyFeedback } from '../src/learn/feedback.ts';
import { connectAccount } from '../src/store/accounts.ts';
import { openDb } from '../src/store/db.ts';
import { listUndecided } from '../src/store/messages.ts';
import { addRule, listRules } from '../src/store/rules.ts';
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

let db: DatabaseSync;
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
      return { additions, historyId: String(++cursor) };
    },
    searchInbox: async () => ({ ids: [] }),
    getMetadata: async (id) => inbox.find((m) => m.id === id) ?? null,
    getBodyText: async (id) => bodies.get(id) ?? null,
    getRaw: async (id) => (bodies.has(id) ? Buffer.from(`Subject: raw ${id}\r\n\r\n${bodies.get(id)}`) : null),
  };
}

const options = (act: boolean): RunOptions => ({ act, connect: () => ({ api: api(), mailbox }), log: (line) => logs.push(line), now: () => 5000 });
const decisions = () => db.prepare('SELECT message_id, stage, disposition, mode, outcome, outcome_detail, rule_id FROM decisions ORDER BY id').all();

beforeEach(() => {
  db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
  mailbox = new FakeMailbox();
  logs = [];
  cursor = 1;
  bodies = new Map();
  inbox = [message('news', 'News <news@example.com>'), message('ada', 'Ada <ada@example.org>')];
  for (const m of inbox) mailbox.labels.set(m.id, [...m.labelIds]);
});

describe('runOnce', () => {
  it('observes by default: records what it would do and changes nothing', async () => {
    addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    await runOnce(db, options(false));

    expect(decisions()).toMatchObject([
      { message_id: 'ada', stage: 'fallback', disposition: 'review', mode: 'observe', outcome: 'observed' },
      { message_id: 'news', stage: 'rules', disposition: 'archive', mode: 'observe', outcome: 'observed' },
    ]);
    expect(mailbox.modifyCalls).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM actions').get()).toEqual({ n: 0 });
    expect(logs).toEqual([`${ACCOUNT}: 2 new; would archive 1, review 1`]);
  });

  it('acts on decisions, links each action to its decision and counts rule hits', async () => {
    const ruleId = addRule(db, ACCOUNT, { match: { listId: 'news.example.com', from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    addRule(db, ACCOUNT, { match: { from: 'ada@example.org' }, labelId: 'personal' }, 'user');
    await runOnce(db, options(true));

    // Both get the label for what they are; only the archived one gets the label for what sift did.
    expect(mailbox.labels.get('news')).toEqual(['UNREAD', 'L:sift/newsletters', 'L:sift/did/archived']);
    expect(mailbox.labels.get('ada')).toEqual(['INBOX', 'UNREAD', 'L:sift/personal']);
    expect(decisions()).toMatchObject([
      { message_id: 'ada', disposition: 'keep', mode: 'act', outcome: 'done' },
      { message_id: 'news', disposition: 'archive', mode: 'act', outcome: 'done', rule_id: ruleId },
    ]);
    expect(db.prepare('SELECT message_id, type, status, decision_id FROM actions ORDER BY message_id').all()).toEqual([
      { message_id: 'ada', type: 'label', status: 'done', decision_id: 1 },
      { message_id: 'news', type: 'archive', status: 'done', decision_id: 2 },
    ]);
    expect(listRules(db, ACCOUNT).map((r) => r.hits)).toEqual([1, 1]);
  });

  it('labels undecided mail for review and leaves it in the inbox', async () => {
    await runOnce(db, options(true));
    expect(mailbox.labels.get('ada')).toEqual(['INBOX', 'UNREAD', 'L:sift/review']);
  });

  it('decides each message once, however many passes run', async () => {
    await runOnce(db, options(true));
    await runOnce(db, options(true));
    expect(decisions()).toHaveLength(2);
    expect(mailbox.modifyCalls).toBe(2);
    expect(logs).toHaveLength(1);
  });

  it('records why a decision was not carried out', async () => {
    addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'marketing', disposition: 'spam' }, 'user');
    mailbox.sentTo.add('news@example.com');
    mailbox.labels.set('ada', ['UNREAD']);
    await runOnce(db, options(true));

    expect(decisions()).toMatchObject([
      { message_id: 'ada', outcome: 'skipped', outcome_detail: 'message is not in the inbox' },
      { message_id: 'news', disposition: 'spam', outcome: 'skipped', outcome_detail: 'you have written to this sender, so spam is refused' },
    ]);
    expect(mailbox.modifyCalls).toBe(0);
  });

  it('keeps a decision it could not carry out and retries it on the next pass', async () => {
    addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user');
    inbox = [inbox[0]!];
    mailbox.failReads = true;
    const [failed] = await runOnce(db, options(true));
    expect(failed?.error).toBe('network down');
    expect(decisions()).toMatchObject([{ message_id: 'news', mode: 'act', outcome: null }]);

    mailbox.failReads = false;
    inbox = [];
    await runOnce(db, options(true));
    expect(decisions()).toMatchObject([{ message_id: 'news', outcome: 'done' }]);
    expect(mailbox.labels.get('news')).toEqual(['UNREAD', 'L:sift/newsletters', 'L:sift/did/archived']);
  });
});

describe('triage queue', () => {
  it('rebuilds triage input from the database without refetching', async () => {
    await runOnce(db, {
      ...options(false),
      connect: () => ({ api: { ...api(), listHistory: async () => ({ additions: [{ id: 'news', labelIds: ['INBOX'] }], historyId: '9' }) }, mailbox }),
    });
    db.exec('DELETE FROM decisions');
    expect(listUndecided(db, ACCOUNT, 10).map((queued) => queued.facts)).toEqual([
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
  const model = (label: string) => ({
    guidelines: () => '',
    judge: async ({ evidence }: { evidence: { facts: { messageId: string } } }) => {
      judged.push(evidence.facts.messageId);
      return { label, reason: 'looks like a mailing', confidence: 0.9, usage: { model: 'test/model', inputTokens: 800, outputTokens: 20, costUsd: 0.002 } };
    },
  });

  it('classifies what no rule covers, does what the label says and records the cost', async () => {
    judged.length = 0;
    inbox = [inbox[0]!];
    await runOnce(db, { ...options(true), model: model('newsletter') });

    expect(db.prepare('SELECT stage, disposition, label_id, gmail_label, model, cost_usd, outcome FROM decisions').get()).toEqual({
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

  it('makes a rule for a sender the model keeps labelling the same way, and stops calling the model for them', async () => {
    judged.length = 0;
    for (const id of ['n1', 'n2', 'n3', 'n4']) {
      inbox = [message(id, 'News <news@example.com>')];
      mailbox.labels.set(id, ['INBOX']);
      await runOnce(db, { ...options(true), model: model('newsletter') });
    }
    expect(judged).toEqual(['n1', 'n2', 'n3']);
    expect(db.prepare(`SELECT stage, disposition, label_id, reason FROM decisions WHERE message_id = 'n4'`).get()).toEqual({
      stage: 'rules',
      disposition: 'archive',
      label_id: 'newsletter',
      reason: 'learned: from news@example.com is Newsletters',
    });
    expect(listRules(db, ACCOUNT)).toMatchObject([{ match: { from: 'news@example.com' }, labelId: 'newsletter', source: 'agent', learned: true }]);
    expect(logs.some((line) => line.includes('learned 1 rule'))).toBe(true);
  });

  it('gathers evidence and classifies in observe mode without changing the mailbox', async () => {
    judged.length = 0;
    inbox = [inbox[0]!];
    await runOnce(db, { ...options(false), model: model('marketing') });
    expect(judged).toEqual(['news']);
    expect(db.prepare('SELECT disposition, mode, outcome FROM decisions').get()).toEqual({ disposition: 'archive', mode: 'observe', outcome: 'observed' });
    expect(mailbox.modifyCalls).toBe(0);
  });
});

describe('blocking', () => {
  const phish = (id: string, authenticated: boolean): RawMessage => {
    const m = message(id, 'Bank <alerts@example.net>', 'Verify your account');
    return { ...m, headers: [...m.headers, { name: 'Authentication-Results', value: `mx.example.org; dmarc=${authenticated ? 'pass' : 'fail'}` }] };
  };
  const phishing = { guidelines: () => '', judge: async () => ({ label: 'phishing', reason: 'asks for a password' }) };

  it('marks the message spam and makes a rule for the sender, so their later mail needs no model', async () => {
    inbox = [phish('p1', true)];
    mailbox.labels.set('p1', ['INBOX']);
    await runOnce(db, { ...options(true), model: phishing });
    expect(mailbox.labels.get('p1')).toEqual(['L:sift/phishing', 'L:sift/did/spam', 'SPAM']);
    expect(listRules(db, ACCOUNT)).toMatchObject([{ match: { from: 'alerts@example.net' }, labelId: 'phishing', source: 'agent' }]);
    expect(logs.at(-1)).toContain('blocked 1 sender');

    let asked = 0;
    inbox = [phish('p2', true)];
    mailbox.labels.set('p2', ['INBOX']);
    await runOnce(db, { ...options(true), model: { guidelines: () => '', judge: async () => (asked++, null) } });
    expect(asked).toBe(0);
    expect(db.prepare(`SELECT stage, disposition, block FROM decisions WHERE message_id = 'p2'`).get()).toEqual({
      stage: 'rules',
      disposition: 'spam',
      block: 1,
    });
  });

  it('does not block a sender whose message did not prove who sent it, or while only observing', async () => {
    inbox = [phish('p1', false)];
    mailbox.labels.set('p1', ['INBOX']);
    await runOnce(db, { ...options(true), model: phishing });
    expect(mailbox.labels.get('p1')).toContain('SPAM');
    expect(listRules(db, ACCOUNT)).toEqual([]);

    inbox = [phish('p2', true)];
    mailbox.labels.set('p2', ['INBOX']);
    await runOnce(db, { ...options(false), model: phishing });
    expect(listRules(db, ACCOUNT)).toEqual([]);
  });

  it('holds mail from someone the user has written to for review instead, and blocks nobody', async () => {
    mailbox.sentTo.add('alerts@example.net');
    inbox = [phish('p1', true)];
    mailbox.labels.set('p1', ['INBOX']);
    await runOnce(db, { ...options(true), model: phishing });
    expect(mailbox.labels.get('p1')).toEqual(['INBOX', 'L:sift/phishing', 'L:sift/review']);
    expect(listRules(db, ACCOUNT)).toEqual([]);
  });
});

describe('examples', () => {
  it('stores marked messages whole on the next pass, while only observing', async () => {
    inbox = [inbox[0]!];
    bodies.set('news', 'The full text of the newsletter.');
    await runOnce(db, { ...options(false), model: { guidelines: () => '', judge: async () => ({ label: 'newsletter', reason: 'r' }) } });
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' });

    inbox = [];
    const [result] = await runOnce(db, options(false));
    expect(result?.captured).toBe(1);
    expect(logs.at(-1)).toContain('stored 1 marked message as examples');
    const example = db.prepare('SELECT label_id, disposition, body_text, raw FROM examples').get() as { raw: Uint8Array; body_text: string };
    expect(example).toMatchObject({ label_id: 'newsletter', disposition: 'archive', body_text: 'The full text of the newsletter.' });
    expect(Buffer.from(example.raw).toString()).toContain('The full text of the newsletter.');
    expect(mailbox.modifyCalls).toBe(0);
  });
});
