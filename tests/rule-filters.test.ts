import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { undo } from '../src/actions/executor.ts';
import { checkRuleFilters, removeRuleFilter, writeRuleFilter } from '../src/actions/rule-filters.ts';
import { FILTER_CHECK_MINUTES, checkFiltersWhenDue } from '../src/work/filters.ts';
import { addMailbox } from '../src/store/accounts.ts';
import { openUserDb, raw } from './fixtures.ts';
import { getRuleFilter, ruleFilterStatus } from '../src/store/filters.ts';
import { DEFAULT_LABELS, updateLabel } from '../src/store/labels.ts';
import { addRule, removeRule, setRule } from '../src/store/rules.ts';
import { type FilterableRule, filterFor } from '../src/triage/filter.ts';
import { listFilterChanges } from '../src/dashboard/queries/rules.ts';
import { FakeMailbox, everything } from './helpers.ts';

const rule = (overrides: Partial<FilterableRule> = {}): FilterableRule => ({
  id: 'r1',
  match: { from: 'news@example.com' },
  labelId: 'newsletter',
  ...overrides,
});
const verdict = (candidate: FilterableRule, others: FilterableRule[] = []) => filterFor(candidate, DEFAULT_LABELS, [candidate, ...others]);
const reason = (candidate: FilterableRule, others: FilterableRule[] = []) => {
  const v = verdict(candidate, others);
  return v.possible ? null : v.reason;
};

describe('whether a rule can be a Gmail filter', () => {
  it('turns a sender rule into a filter that labels and, where the label archives, skips the inbox', () => {
    expect(verdict(rule())).toMatchObject({
      possible: true,
      plan: { criteria: { from: 'news@example.com' }, gmailLabel: 'sift/newsletters', archive: true },
    });
    expect(verdict(rule({ labelId: 'personal' }))).toMatchObject({ possible: true, plan: { gmailLabel: 'sift/personal', archive: false }, differs: [] });
    expect(verdict(rule({ disposition: 'keep' }))).toMatchObject({ possible: true, plan: { gmailLabel: 'sift/newsletters', archive: false } });
  });

  it('turns a rule that only archives into a filter that only skips the inbox', () => {
    const archive: FilterableRule = { id: 'a', match: { from: 'notifications@example.com' }, disposition: 'archive' };
    const v = verdict(archive);
    expect(v).toMatchObject({ possible: true, plan: { criteria: { from: 'notifications@example.com' }, archive: true } });
    expect(v.possible && v.plan).not.toHaveProperty('gmailLabel');
    expect(reason({ ...archive, disposition: 'keep' })).toMatch(/Gmail does anyway/);
    expect(reason({ ...archive, disposition: 'spam' })).toMatch(/spam/);
  });

  it('writes a domain, a recipient and subject words as Gmail matches them, and says where that differs', () => {
    const v = verdict(rule({ match: { fromDomain: 'Example.com', to: 'Me@example.org', subjectContains: ' weekly digest ' }, labelId: 'personal' }));
    expect(v).toMatchObject({ possible: true, plan: { criteria: { from: '@example.com', to: 'me@example.org', subject: '"weekly digest"' } } });
    expect(v.possible && v.differs).toHaveLength(2);
  });

  it('refuses what Gmail cannot do or sift will not let a filter do', () => {
    expect(reason(rule({ labelId: 'junk' }))).toMatch(/spam/);
    expect(reason(rule({ labelId: 'phishing' }))).toMatch(/spam/);
    expect(reason(rule({ disposition: 'spam' }))).toMatch(/spam/);
    expect(reason(rule({ markRead: true }))).toMatch(/marks mail read/);
    expect(reason(rule({ match: { listId: 'news.example.com' } }))).toMatch(/mailing list/);
    expect(reason(rule({ except: [{ subjectContains: 'invoice' }] }))).toMatch(/exceptions/);
    expect(reason(rule({ labelId: 'no-such-label' }))).toMatch(/label has been removed/);
    expect(reason(rule({ match: { from: 'news@example.com', facts: { unsubscribe: 'one-click' } } }))).toBe(
      'It asks what Sift found in the message, which Gmail filters cannot see.',
    );
  });

  it('holds back a filter that would get to mail a narrower rule on a fact keeps', () => {
    const replies: FilterableRule = { id: 'r2', match: { from: 'news@example.com', facts: { isReply: true } }, labelId: 'personal' };
    expect(reason(rule(), [replies])).toMatch(/Another rule \(from news@example.com, is a reply\)/);
  });

  it('refuses a rule that is judged, not matched', () => {
    expect(reason({ id: 'r', match: { from: 'news@example.com' }, whenLabel: 'newsletter' })).toMatch(/once Sift has said what the mail is/);
    expect(reason(rule({ when: 'it is an auction notice' }))).toMatch(/plain language/);
    expect(verdict(rule()).possible).toBe(true);
  });

  it('refuses a rule sift learned when it would hide mail, since a filter cannot spare people the user writes to', () => {
    expect(reason(rule({ learned: true }))).toMatch(/learned/);
    expect(verdict(rule({ learned: true, labelId: 'personal' })).possible).toBe(true);
  });

  it('refuses values that would change the meaning of a Gmail search', () => {
    for (const match of [
      { from: 'a@example.com OR b@example.com' },
      { from: '{a@example.com b@example.com}' },
      { fromDomain: 'example.com) OR (from:example.org' },
      { to: 'me@example.org has:attachment' },
      { subjectContains: 'offer" OR "invoice' },
      { from: 'a@example.com', fromDomain: 'example.org' },
    ]) {
      expect(reason(rule({ match }))).toMatch(/safely/);
    }
  });

  it('refuses a rule another rule could overrule, because Gmail would run the filter regardless', () => {
    const domain = rule({ id: 'domain', match: { fromDomain: 'example.com' } });
    const billing = rule({ id: 'billing', match: { from: 'billing@example.com' }, labelId: 'transactional' });
    // The narrower keep rule wins in sift, so the broad archive cannot go ahead of it; the keep rule itself can.
    expect(reason(domain, [billing])).toMatch(/Another rule \(from billing@example.com\)/);
    expect(verdict(billing, [domain]).possible).toBe(true);

    // A keep rule beats an archive rule however broad it is.
    const keepAll = rule({ id: 'keep', match: { to: 'me@example.org' }, labelId: 'personal' });
    expect(reason(rule(), [keepAll])).toMatch(/Another rule/);

    // A rule for the same sender that is judged can say "not this one".
    expect(reason(rule(), [{ id: 'soft', match: rule().match, whenLabel: 'marketing' }])).toMatch(/Another rule/);

    // Rules that cannot match the same mail, agree, or name a removed label are no obstacle.
    const elsewhere = rule({ id: 'other', match: { from: 'ada@example.org' }, labelId: 'personal' });
    const agrees = rule({ id: 'agrees', match: { fromDomain: 'example.com' } });
    const dead = rule({ id: 'dead', match: { fromDomain: 'example.com' }, labelId: 'no-such-label' });
    expect(verdict(rule(), [elsewhere, agrees, dead]).possible).toBe(true);
  });
});

const ACCOUNT = 'me@example.org';
let db: Sql;
let mailbox: FakeMailbox;
let clock: number;
const deps = () => ({ db, mailbox, now: () => clock });
const actions = async () => await raw(db).all<{ type: string; status: string }>('SELECT type, status, message_id, payload FROM actions ORDER BY id');

beforeEach(async () => {
  db = await openUserDb(ACCOUNT);
  await addMailbox(db, ACCOUNT, '1', 0);
  mailbox = new FakeMailbox();
  clock = 1000;
});

describe("a rule's Gmail filter", () => {
  it('is created through the audit log, read back, and recorded on the rule', async () => {
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    await writeRuleFilter(deps(), id);

    expect(mailbox.filters).toEqual([
      { id: expect.any(String), criteria: { from: 'news@example.com' }, action: { addLabelIds: ['L:sift/newsletters'], removeLabelIds: ['INBOX'] } },
    ]);
    expect(await getRuleFilter(db, id)).toMatchObject({ filterId: mailbox.filters[0]!.id, state: 'active', checkedAt: 1000 });
    expect(await actions()).toEqual([
      {
        type: 'filter',
        status: 'done',
        message_id: null,
        payload: {
          add: [],
          remove: [],
          filter: { ruleId: id, criteria: { from: 'news@example.com' }, action: { addLabelIds: ['L:sift/newsletters'], removeLabelIds: ['INBOX'] } },
        },
      },
    ]);
    await expect(undo(deps(), 1)).rejects.toThrow(/not undone/);
  });

  it('is refused, with nothing sent to Gmail, for a rule that cannot be one', async () => {
    const id = await addRule(db, ACCOUNT, { match: { from: 'junk@example.com' }, labelId: 'junk' }, 'user');
    await expect(writeRuleFilter(deps(), id)).rejects.toThrow('Gmail filters cannot mark mail as spam.');
    await expect(writeRuleFilter(deps(), 'r-missing')).rejects.toThrow(/no longer exists/);
    const replies = await addRule(db, ACCOUNT, { match: { from: 'news@example.com', facts: { isReply: false } }, labelId: 'newsletter' }, 'user');
    await expect(writeRuleFilter(deps(), replies)).rejects.toThrow('It asks what Sift found in the message, which Gmail filters cannot see.');
    expect(mailbox.filters).toEqual([]);
    expect(await actions()).toEqual([]);
  });

  it('takes over a filter the account already has that does the same, and replaces its own when asked again', async () => {
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    mailbox.filters.push({ id: 'theirs', criteria: { from: 'News@Example.com' }, action: { addLabelIds: ['L:sift/newsletters'], removeLabelIds: ['INBOX'] } });
    await writeRuleFilter(deps(), id);
    expect(mailbox.filters.map((f) => f.id)).toEqual(['theirs']);
    expect((await getRuleFilter(db, id))?.filterId).toBe('theirs');

    await writeRuleFilter(deps(), id);
    expect(mailbox.filters).toHaveLength(1);
    expect((await getRuleFilter(db, id))?.filterId).toBe(mailbox.filters[0]!.id);
    expect((await actions()).map((a) => `${a.type} ${a.status}`)).toEqual(['filter done', 'unfilter done', 'filter done']);
  });

  it('records a call that failed as unknown and leaves the rule without a filter', async () => {
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    const create = mailbox.createFilter.bind(mailbox);
    mailbox.createFilter = async (filter) => {
      await create(filter);
      throw new Error('timeout');
    };
    await expect(writeRuleFilter(deps(), id)).rejects.toThrow('timeout');
    expect((await actions()).map((a) => `${a.type} ${a.status}`)).toEqual(['filter unknown']);
    expect(await getRuleFilter(db, id)).toMatchObject({ filterId: null, state: null });

    // It did land in Gmail. Asking again adopts it instead of making a second.
    mailbox.createFilter = create;
    await writeRuleFilter(deps(), id);
    expect(mailbox.filters).toHaveLength(1);
    expect(await getRuleFilter(db, id)).toMatchObject({ filterId: mailbox.filters[0]!.id, state: 'active' });
  });

  describe('made in Gmail when reading it back failed', () => {
    let id: string;
    beforeEach(async () => {
      id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
      const list = mailbox.listFilters.bind(mailbox);
      let calls = 0;
      mailbox.listFilters = async () => {
        if (++calls === 2) throw new Error('timeout');
        return await list();
      };
      await expect(writeRuleFilter(deps(), id)).rejects.toThrow('timeout');
      expect(mailbox.filters).toHaveLength(1);
      expect(await getRuleFilter(db, id)).toMatchObject({ filterId: null });
    });

    it('is found and taken out when its rule is', async () => {
      expect(await removeRuleFilter(deps(), id)).toBe(true);
      expect(mailbox.filters).toEqual([]);
      expect((await actions()).map((a) => `${a.type} ${a.status}`)).toEqual(['filter done', 'unfilter done']);
    });

    it('is put on its rule by the next check', async () => {
      expect(await checkRuleFilters(deps(), ACCOUNT, false)).toEqual({ gone: 0, changed: 0, outdated: 0 });
      expect(await getRuleFilter(db, id)).toMatchObject({ filterId: mailbox.filters[0]!.id, state: 'active' });
      expect((await actions()).map((a) => `${a.type} ${a.status}`)).toEqual(['filter done']);
    });

    it('is taken out by the next check once its rule is gone, or says something else', async () => {
      await removeRule(db, id);
      expect(await checkRuleFilters(deps(), ACCOUNT, false)).toBeNull();
      expect(mailbox.filters).toEqual([]);
      expect((await actions()).map((a) => `${a.type} ${a.status}`)).toEqual(['filter done', 'unfilter done']);
    });

    it('stays open while Gmail cannot be reached, and is settled once it can', async () => {
      mailbox.failFilters = true;
      await expect(removeRuleFilter(deps(), id)).rejects.toThrow('network down');
      expect((await actions()).map((a) => `${a.type} ${a.status}`)).toEqual(['filter unknown']);
      mailbox.failFilters = false;
      await setRule(db, ACCOUNT, { from: 'news@example.com' }, { labelId: 'personal' }, 'user');
      await checkRuleFilters(deps(), ACCOUNT, false);
      expect(mailbox.filters).toEqual([]);
      expect(await getRuleFilter(db, id)).toMatchObject({ filterId: null });
    });
  });

  it('is removed through the audit log, and removing one already deleted in Gmail succeeds', async () => {
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    await writeRuleFilter(deps(), id);
    expect(await removeRuleFilter(deps(), id)).toBe(true);
    expect(mailbox.filters).toEqual([]);
    expect(await getRuleFilter(db, id)).toMatchObject({ filterId: null, state: null });
    expect(await removeRuleFilter(deps(), id)).toBe(false);

    await writeRuleFilter(deps(), id);
    mailbox.filters = [];
    expect(await removeRuleFilter(deps(), id)).toBe(true);
    expect((await actions()).map((a) => `${a.type} ${a.status}`)).toEqual(['filter done', 'unfilter done', 'filter done', 'unfilter done']);
  });

  it('lists the filters written and taken out in a period, newest first, by what they matched', async () => {
    const DAY = 86_400_000;
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    await writeRuleFilter(deps(), id);
    clock = 3 * DAY;
    await removeRuleFilter(deps(), id);
    await removeRule(db, id);
    const listed = async (days: number) => listFilterChanges(db, await everything(db), days, 4 * DAY);
    expect(await listed(7)).toMatchObject([
      { type: 'unfilter', status: 'done', ruleId: null, criteria: { from: 'news@example.com' }, at: 3 * DAY },
      { type: 'filter', status: 'done', ruleId: null, criteria: { from: 'news@example.com' }, at: 1000 },
    ]);
    expect(await listed(1)).toMatchObject([{ type: 'unfilter', criteria: { from: 'news@example.com' } }]);
  });

  it('tells the dashboard the filter it would write, and when it last wrote or took one out', async () => {
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    expect((await ruleFilterStatus(db)).get(id)).toMatchObject({
      plan: { criteria: { from: 'news@example.com' }, gmailLabel: 'sift/newsletters', archive: true },
      last: null,
    });
    await writeRuleFilter(deps(), id);
    expect((await ruleFilterStatus(db)).get(id)?.last).toEqual({ type: 'filter', status: 'done', error: null, at: clock });
    mailbox.failFilters = true;
    await expect(removeRuleFilter(deps(), id)).rejects.toThrow('network down');
    expect((await ruleFilterStatus(db)).get(id)?.last).toMatchObject({ type: 'unfilter', status: 'unknown', error: 'network down' });
  });

  it('keeps the rule marked as a filter when Gmail could not be reached to remove it', async () => {
    const id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    await writeRuleFilter(deps(), id);
    mailbox.failFilters = true;
    await expect(removeRuleFilter(deps(), id)).rejects.toThrow('network down');
    expect(await getRuleFilter(db, id)).toMatchObject({ state: 'active' });
    expect((await actions()).at(-1)).toMatchObject({ type: 'unfilter', status: 'unknown' });
  });
});

describe('checking filters against Gmail', () => {
  let id: string;
  beforeEach(async () => {
    id = await addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'user');
    await writeRuleFilter(deps(), id);
    clock = 2000;
  });

  it('does not ask Gmail when no rule has a filter', async () => {
    await removeRuleFilter(deps(), id);
    mailbox.failFilters = true;
    expect(await checkRuleFilters(deps(), ACCOUNT, true)).toBeNull();
  });

  it('confirms a filter that is still as written', async () => {
    expect(await checkRuleFilters(deps(), ACCOUNT, false)).toEqual({ gone: 0, changed: 0, outdated: 0 });
    expect(await getRuleFilter(db, id)).toMatchObject({ state: 'active', checkedAt: 2000 });
    expect((await ruleFilterStatus(db)).get(id)).toMatchObject({ state: 'active', possible: true, checkedAt: 2000 });
  });

  it('notices one the user deleted in Gmail and does not put it back', async () => {
    mailbox.filters = [];
    expect(await checkRuleFilters(deps(), ACCOUNT, true)).toEqual({ gone: 1, changed: 0, outdated: 0 });
    expect(await getRuleFilter(db, id)).toMatchObject({ filterId: null, state: 'gone' });
    expect(await checkRuleFilters(deps(), ACCOUNT, true)).toBeNull();
    expect(mailbox.filters).toEqual([]);
  });

  it('notices one the user edited in Gmail, leaves it alone, and sees it put back', async () => {
    mailbox.filters[0]!.criteria['subject'] = 'digest';
    expect(await checkRuleFilters(deps(), ACCOUNT, true)).toEqual({ gone: 0, changed: 1, outdated: 0 });
    expect(await getRuleFilter(db, id)).toMatchObject({ filterId: mailbox.filters[0]!.id, state: 'changed' });
    // Reported once, not on every check.
    expect(await checkRuleFilters(deps(), ACCOUNT, true)).toEqual({ gone: 0, changed: 0, outdated: 0 });
    expect(mailbox.filters[0]!.criteria).toEqual({ from: 'news@example.com', subject: 'digest' });

    delete mailbox.filters[0]!.criteria['subject'];
    await checkRuleFilters(deps(), ACCOUNT, true);
    expect(await getRuleFilter(db, id)).toMatchObject({ state: 'active' });
  });

  it('replaces a filter whose rule now says something else, or only marks it while sift is off', async () => {
    await setRule(db, ACCOUNT, { from: 'news@example.com' }, { labelId: 'personal' }, 'user');
    expect(await checkRuleFilters(deps(), ACCOUNT, false)).toEqual({ gone: 0, changed: 0, outdated: 1 });
    expect(await getRuleFilter(db, id)).toMatchObject({ state: 'outdated' });
    expect(mailbox.filters[0]!.action.removeLabelIds).toEqual(['INBOX']);

    await checkRuleFilters(deps(), ACCOUNT, true);
    expect(mailbox.filters).toEqual([
      { id: expect.any(String), criteria: { from: 'news@example.com' }, action: { addLabelIds: ['L:sift/personal'], removeLabelIds: [] } },
    ]);
    expect(await getRuleFilter(db, id)).toMatchObject({ filterId: mailbox.filters[0]!.id, state: 'active' });
  });

  it('removes a filter whose rule can no longer be one, such as when its label starts marking spam', async () => {
    await updateLabel(db, ACCOUNT, 'newsletter', { disposition: 'spam' });
    expect(await checkRuleFilters(deps(), ACCOUNT, true)).toEqual({ gone: 0, changed: 0, outdated: 1 });
    expect(mailbox.filters).toEqual([]);
    expect(await getRuleFilter(db, id)).toMatchObject({ filterId: null, state: 'outdated' });
    expect((await ruleFilterStatus(db)).get(id)).toMatchObject({ state: 'outdated', possible: false, reason: 'Gmail filters cannot mark mail as spam.' });
  });

  it('removes a filter when a later rule could overrule it', async () => {
    await addRule(db, ACCOUNT, { match: { from: 'news@example.com', subjectContains: 'invoice' }, labelId: 'transactional' }, 'user');
    await checkRuleFilters(deps(), ACCOUNT, true);
    expect(mailbox.filters).toEqual([]);
  });

  it('runs at most once every few minutes per account', async () => {
    mailbox.filters = [];
    expect(await checkFiltersWhenDue(deps(), ACCOUNT, false)).toEqual({ gone: 1, changed: 0, outdated: 0 });
    await writeRuleFilter(deps(), id);
    mailbox.filters = [];
    clock += FILTER_CHECK_MINUTES * 60_000 - 1;
    expect(await checkFiltersWhenDue(deps(), ACCOUNT, false)).toBeNull();
    expect(await getRuleFilter(db, id)).toMatchObject({ state: 'active' });
    clock += 1;
    expect(await checkFiltersWhenDue(deps(), ACCOUNT, false)).toEqual({ gone: 1, changed: 0, outdated: 0 });
  });
});
