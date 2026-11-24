import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listRuleSummaries } from '../src/dashboard/queries/rules.ts';
import { addRule, setRule } from '../src/store/rules.ts';
import {
  addedWords,
  factStart,
  keepStart,
  listStart,
  matchOf,
  messageStart,
  nameStart,
  proposalStart,
  replacedBy,
  standingStart,
  startWords,
} from '../web/src/lib/rule-start.ts';
import { onePerson } from './fixtures.ts';
import { ACCOUNT, everything } from './helpers.ts';

describe('where each way into the rule dialog starts it', () => {
  it('starts a proposal on its sender, waiting for its label and then doing what the label does', () => {
    expect(proposalStart({ from: ['news@example.com'] }, 'newsletter', 'archive')).toEqual({
      conditions: [{ by: 'from', value: 'news@example.com' }],
      facts: [],
      whenLabel: 'newsletter',
      action: 'archive',
    });
    expect(proposalStart({ fromDomain: ['example.com'], facts: { isReply: false } }, 'newsletter', 'keep')).toEqual({
      conditions: [{ by: 'from', value: 'example.com' }],
      facts: [{ key: 'isReply', index: 1 }],
      whenLabel: 'newsletter',
      action: 'keep',
    });
    expect(proposalStart({ from: ['x@example.com'] }, 'junk', 'block')).toMatchObject({ action: 'spam' });
    expect(proposalStart({ from: ['x@example.com'] }, 'unsure', 'review')).toMatchObject({ action: 'keep' });
  });

  it("starts a message's Make a rule on its sender and the label Mild gave it, if any", () => {
    expect(messageStart('ada@example.org', 'personal')).toEqual({ conditions: [{ by: 'from', value: 'ada@example.org' }], facts: [], label: 'personal' });
    expect(messageStart('ada@example.org', null)).toEqual({ conditions: [{ by: 'from', value: 'ada@example.org' }], facts: [] });
  });

  it('starts a fact row on the sender and that fact, and the list row on the list', () => {
    expect(factStart('deals@example.com', { key: 'unsubscribe', index: 0 })).toEqual({
      conditions: [{ by: 'from', value: 'deals@example.com' }],
      facts: [{ key: 'unsubscribe', index: 0 }],
    });
    expect(listStart('promo.example.com')).toEqual({ conditions: [{ by: 'listId', value: 'promo.example.com' }], facts: [] });
  });

  it('starts a standing on the sender or domain and what that standing does, with no label', () => {
    expect(standingStart({ address: 'x@example.com' }, 'trusted')).toEqual({ conditions: [{ by: 'from', value: 'x@example.com' }], facts: [], action: 'keep' });
    expect(standingStart({ address: 'x@example.com' }, 'unwanted')).toMatchObject({ action: 'archive' });
    expect(standingStart({ domain: 'example.net' }, 'blocked')).toEqual({ conditions: [{ by: 'from', value: 'example.net' }], facts: [], action: 'spam' });
  });

  it('starts on every value a rule names, an address and a domain both as from, and says them as alternatives', () => {
    const start = proposalStart({ from: ['a@example.com'], fromDomain: ['example.net'], subjectContains: ['receipt', 'invoice'] }, 'newsletter', 'archive');
    expect(start.conditions).toEqual([
      { by: 'from', value: 'a@example.com' },
      { by: 'from', value: 'example.net' },
      { by: 'subjectContains', value: 'receipt' },
      { by: 'subjectContains', value: 'invoice' },
    ]);
    expect(matchOf(start.conditions)).toEqual({ from: ['a@example.com'], fromDomain: ['example.net'], subjectContains: ['receipt', 'invoice'] });
    expect(startWords(start, [{ id: 'newsletter', name: 'Newsletters' }])).toBe(
      'Mail from a@example.com or example.net with a subject containing “receipt” or “invoice”, once it is Newsletters: archive it.',
    );
    expect(nameStart('a@example.com', 'Ada', null).conditions).toEqual([
      { by: 'from', value: 'a@example.com' },
      { by: 'fromName', value: 'Ada' },
    ]);
    expect(
      matchOf([
        { by: 'from', value: ' @example.org ' },
        { by: 'to', value: '' },
      ]),
    ).toEqual({ fromDomain: ['example.org'] });
  });

  it('says a rule that leaves mail in the inbox as that, not as a label', () => {
    expect(startWords({ conditions: [{ by: 'from', value: 'bills@example.com' }], facts: [], label: 'everything_else' }, [])).toBe(
      'Mail from bills@example.com: leave it in the inbox.',
    );
  });

  it('says a rule just added as the rule, by its name if it has one, with no full stop', () => {
    const labels = [{ id: 'receipts', name: 'Receipts' }];
    const from = [{ by: 'from' as const, value: 'shop.example.com' }];
    expect(addedWords({ conditions: from, facts: [], action: 'spam' }, labels)).toBe('Mail from shop.example.com: send it to spam');
    expect(addedWords({ conditions: from, facts: [], label: 'receipts' }, labels, { name: ' Shop receipts ' })).toBe('Shop receipts is Receipts');
    expect(addedWords({ conditions: from, facts: [], label: 'receipts' }, labels, { name: '', when: 'an order that shipped' })).toBe(
      'Mail from shop.example.com is Receipts, if it is “an order that shipped”',
    );
  });

  it('starts keeping mail that is what Mild says, as a rule that waits for its label', () => {
    expect(keepStart('x@example.com', 'marketing')).toEqual({
      conditions: [{ by: 'from', value: 'x@example.com' }],
      facts: [],
      whenLabel: 'marketing',
      action: 'keep',
    });
  });

  it('names the rule adding would replace, the same one the write replaces', async () => {
    const { db } = await onePerson(ACCOUNT);
    const waiting = await addRule(db, { match: { from: ['x@example.com'] }, whenLabel: 'newsletter' }, 'user');
    await addRule(db, { match: { from: ['x@example.com'] }, except: [{ subjectContains: ['sale'] }], disposition: 'keep' }, 'user');
    const mine = await addRule(db, { match: { from: ['x@example.com'], facts: { isReply: false } }, labelId: 'newsletter' }, 'user');
    const rules = await listRuleSummaries(db, await everything(db), Date.now());

    expect(replacedBy(rules, { facts: { isReply: false }, from: ['x@example.com'] }, null)?.id).toBe(mine);
    expect(replacedBy(rules, { from: ['x@example.com'] }, null)).toBeUndefined();
    expect(await setRule(db, { facts: { isReply: false }, from: ['x@example.com'] }, { disposition: 'archive' }, 'user')).toBe(mine);
    expect(replacedBy(rules, { from: ['x@example.com'] }, 'newsletter')?.id).toBe(waiting);
    expect(replacedBy(rules, { from: ['x@example.com'] }, 'marketing')).toBeUndefined();
    const both = await addRule(db, { match: { from: ['x@example.com', 'y@example.com'] }, disposition: 'archive' }, 'user');
    const again = await listRuleSummaries(db, await everything(db), Date.now());
    expect(replacedBy(again, { from: ['Y@example.com', 'x@example.com'] }, null)?.id).toBe(both);
    expect(await setRule(db, { from: ['Y@example.com', 'x@example.com'] }, { disposition: 'keep' }, 'user')).toBe(both);
    expect(await setRule(db, { from: ['x@example.com'] }, { whenLabel: 'newsletter', disposition: 'keep' }, 'user')).toBe(waiting);
  });
});

describe('making a rule from the dashboard', () => {
  it('always goes through the rule dialog, so the user sees the rule and agrees before it is added', () => {
    const pages = globSync('web/src/**/*.{ts,tsx}').filter((file) => file !== 'web/src/lib/api/endpoints.ts');
    const adding = pages.filter((file) => readFileSync(file, 'utf8').includes('api.addRule('));
    expect(adding).toEqual(['web/src/components/rule-dialog.tsx']);
  });
});
