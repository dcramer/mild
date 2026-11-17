import { beforeEach, describe, expect, it } from 'vitest';
import type { RawMessage } from '../src/gmail/api.ts';
import type { Sql } from '../src/store/sql.ts';
import { pendingSuggestions } from '../src/learn/feedback.ts';
import { redecideWaiting } from '../src/learn/redecide.ts';
import { addMailbox, listAccounts, recordSync } from '../src/store/accounts.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { addRule } from '../src/store/rules.ts';
import type { MessageFacts } from '../src/triage/types.ts';
import { applyRule, inboxQuery, ruleInbox } from '../src/work/apply.ts';
import { triageAccount } from '../src/work/triage.ts';
import { openUserDb, raw } from './fixtures.ts';
import { FakeMailbox, facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
let db: Sql;

const message = (id: string, address: string, subject = `Subject ${id}`) =>
  facts({ accountId: ACCOUNT, messageId: id, threadId: `t-${id}`, from: { address, domain: address.split('@')[1]! }, subject, receivedAt: 1000 });

const asGmail = (m: MessageFacts): RawMessage => ({
  id: m.messageId,
  threadId: m.threadId,
  labelIds: m.labelIds,
  internalDate: m.receivedAt,
  headers: [
    { name: 'From', value: m.from.address },
    { name: 'To', value: ACCOUNT },
    { name: 'Subject', value: m.subject },
  ],
});

/** A Gmail whose inbox holds `inbox`, answering every search with all of it: the rule is what narrows it. */
function gmail(inbox: MessageFacts[]) {
  const searches: string[] = [];
  const fetched: string[] = [];
  return {
    searches,
    fetched,
    api: {
      searchInbox: async (query: string) => (searches.push(query), { ids: inbox.map((m) => m.messageId) }),
      getMetadata: async (id: string) => {
        fetched.push(id);
        const found = inbox.find((m) => m.messageId === id);
        return found ? asGmail(found) : null;
      },
    },
  };
}

const decisionsOf = async (id: string) =>
  await raw(db).all('SELECT stage, disposition, label_id, rule_id, carry_out, by_user FROM decisions WHERE message_id = ? ORDER BY id', id);

beforeEach(async () => {
  db = await openUserDb(ACCOUNT);
  await addMailbox(db, ACCOUNT, '1', 0);
});

describe('searching the inbox for a rule', () => {
  it('asks Gmail only for what the rule names, and leaves out what could change the search', () => {
    expect(inboxQuery({ fromDomain: 'news.example.com', subjectContains: 'Weekly' })).toBe('from:news.example.com subject:"Weekly"');
    expect(inboxQuery({ from: 'a@example.com', to: 'me+x@example.org', listId: 'list.example.com' })).toBe(
      'from:a@example.com to:me+x@example.org list:list.example.com',
    );
    expect(inboxQuery({ from: 'a@example.com OR in:sent', subjectContains: 'say "hi"' })).toBe('');
  });
});

describe('applying a rule to the inbox', () => {
  it('finds what the rule decides, seen or not, and leaves out what another rule or the user has decided', async () => {
    const rule = await addRule(db, ACCOUNT, { match: { fromDomain: 'news.example.com' }, labelId: 'marketing' }, 'user');
    await addRule(db, ACCOUNT, { match: { from: 'vip@news.example.com' }, disposition: 'keep' }, 'user');
    const seen = message('seen', 'deals@news.example.com');
    const answered = message('answered', 'deals@news.example.com');
    await recordSync(db, ACCOUNT, [seen, answered], '2');
    await recordDecision(db, ACCOUNT, 'seen', { disposition: 'review', subscription: 'preserve', stage: 'model', reason: 'unsure' }, { now: 1 });
    await recordDecision(db, ACCOUNT, 'answered', { disposition: 'keep', subscription: 'preserve', stage: 'model', reason: 'r' }, { now: 1, byUser: true });
    await redecideWaiting(db, ACCOUNT, 2);
    const { api, searches, fetched } = gmail([
      seen,
      answered,
      message('unseen', 'tips@news.example.com'),
      message('vip', 'vip@news.example.com'),
      message('other', 'ada@example.org'),
    ]);

    const { matches, capped } = await ruleInbox(db, api, ACCOUNT, rule);
    expect(searches).toEqual(['from:news.example.com']);
    expect(capped).toBe(false);
    expect(matches.map(({ messageId, seen, reads }) => ({ messageId, seen, reads }))).toEqual([
      { messageId: 'seen', seen: true, reads: false },
      { messageId: 'unseen', seen: false, reads: false },
    ]);
    // Mail Sift has a record of is not fetched again.
    expect(fetched).toEqual(['unseen', 'vip', 'other']);
    expect(await raw(db).get(`SELECT count(*) AS n FROM messages WHERE id = 'unseen'`)).toEqual({ n: 0 });
  });

  it("records each as the user's press, to be carried out while Sift is off, and no longer waiting", async () => {
    const rule = await addRule(db, ACCOUNT, { match: { fromDomain: 'news.example.com' }, labelId: 'marketing' }, 'user');
    const seen = message('seen', 'deals@news.example.com');
    await recordSync(db, ACCOUNT, [seen], '2');
    await recordDecision(db, ACCOUNT, 'seen', { disposition: 'review', subscription: 'preserve', stage: 'model', reason: 'unsure' }, { now: 1 });
    await redecideWaiting(db, ACCOUNT, 2);
    const unseen = message('unseen', 'tips@news.example.com');
    const { api } = gmail([seen, unseen]);

    expect(await applyRule(db, api, ACCOUNT, rule, ['seen', 'unseen', 'unseen', 'gone'], 3)).toEqual({ deciding: 2, reading: 0 });
    for (const id of ['seen', 'unseen'])
      expect((await decisionsOf(id)).at(-1)).toEqual({
        stage: 'rules',
        disposition: 'archive',
        label_id: 'marketing',
        rule_id: rule,
        carry_out: true,
        by_user: true,
      });
    // Pressed twice, nothing more happens.
    expect(await applyRule(db, api, ACCOUNT, rule, ['seen'], 4)).toEqual({ deciding: 0, reading: 0 });

    const mailbox = new FakeMailbox();
    mailbox.labels.set('seen', ['INBOX']);
    mailbox.labels.set('unseen', ['INBOX']);
    await triageAccount({ db, mailbox: null, answers: mailbox }, (await listAccounts(db))[0]!);
    expect(mailbox.labels.get('seen')).not.toContain('INBOX');
    expect(mailbox.labels.get('unseen')).not.toContain('INBOX');
    expect(await pendingSuggestions(db)).toEqual([]);
  });

  it('marks mail a model must read first, and carries out what the rule decides once it has', async () => {
    const rule = await addRule(db, ACCOUNT, { match: { fromDomain: 'news.example.com' }, whenLabel: 'marketing', disposition: 'spam' }, 'user');
    const sale = message('sale', 'deals@news.example.com');
    const note = message('note', 'ceo@news.example.com');
    const { api } = gmail([sale, note]);

    const { matches } = await ruleInbox(db, api, ACCOUNT, rule);
    expect(matches.map((m) => [m.messageId, m.reads])).toEqual([
      ['sale', true],
      ['note', true],
    ]);
    expect(await applyRule(db, api, ACCOUNT, rule, ['sale', 'note'], 3)).toEqual({ deciding: 0, reading: 2 });
    expect(await raw(db).all('SELECT id, apply_rule FROM messages ORDER BY id')).toEqual([
      { id: 'note', apply_rule: rule },
      { id: 'sale', apply_rule: rule },
    ]);

    const mailbox = new FakeMailbox();
    mailbox.labels.set('sale', ['INBOX']);
    mailbox.labels.set('note', ['INBOX']);
    const sources = { api: { getContent: async () => null, getThread: async () => null }, mailbox: { hasSentTo: async () => false } };
    const model = {
      judge: async ({ evidence }: { evidence: { facts: MessageFacts } }) =>
        evidence.facts.messageId === 'sale' ? { label: 'marketing', reason: 'a sale' } : { label: 'personal', reason: 'from a person' },
      model: 'test/model',
    };
    await triageAccount({ db, mailbox: null, answers: mailbox, model, sources }, (await listAccounts(db))[0]!);
    expect(await decisionsOf('sale')).toEqual([{ stage: 'model', disposition: 'spam', label_id: 'marketing', rule_id: rule, carry_out: true, by_user: true }]);
    expect(mailbox.labels.get('sale')).toContain('SPAM');
    // What the model found it to be is a suggestion, as any mail is while Sift is off.
    expect(await decisionsOf('note')).toEqual([{ stage: 'model', disposition: 'keep', label_id: 'personal', rule_id: null, carry_out: false, by_user: false }]);
    expect(mailbox.labels.get('note')).toEqual(['INBOX']);
  });
});
