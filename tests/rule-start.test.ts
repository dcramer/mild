import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listRuleSummaries } from '../src/dashboard/queries/rules.ts';
import { addRule, setRule } from '../src/store/rules.ts';
import { factStart, keepStart, listStart, messageStart, proposalStart, replacedBy, standingStart } from '../web/src/lib/rule-start.ts';
import { onePerson } from './fixtures.ts';
import { everything } from './helpers.ts';

const ACCOUNT = 'me@example.org';

describe('where each way into the rule dialog starts it', () => {
  it('starts a proposal on its sender, waiting for its label and then doing what the label does', () => {
    expect(proposalStart({ from: 'news@example.com' }, 'newsletter', 'archive')).toEqual({
      by: 'from',
      value: 'news@example.com',
      facts: [],
      whenLabel: 'newsletter',
      action: 'archive',
    });
    expect(proposalStart({ fromDomain: 'example.com', facts: { isReply: false } }, 'newsletter', 'keep')).toEqual({
      by: 'from',
      value: 'example.com',
      facts: [{ key: 'isReply', index: 1 }],
      whenLabel: 'newsletter',
      action: 'keep',
    });
    expect(proposalStart({ from: 'x@example.com' }, 'junk', 'block')).toMatchObject({ action: 'spam' });
    expect(proposalStart({ from: 'x@example.com' }, 'unsure', 'review')).toMatchObject({ action: 'keep' });
  });

  it("starts a message's Make a rule on its sender and the label sift gave it, if any", () => {
    expect(messageStart('ada@example.org', 'personal')).toEqual({ by: 'from', value: 'ada@example.org', facts: [], label: 'personal' });
    expect(messageStart('ada@example.org', null)).toEqual({ by: 'from', value: 'ada@example.org', facts: [] });
  });

  it('starts a fact row on the sender and that fact, and the list row on the list', () => {
    expect(factStart('deals@example.com', { key: 'unsubscribe', index: 0 })).toEqual({
      by: 'from',
      value: 'deals@example.com',
      facts: [{ key: 'unsubscribe', index: 0 }],
    });
    expect(listStart('promo.example.com')).toEqual({ by: 'listId', value: 'promo.example.com', facts: [] });
  });

  it('starts a standing on the sender or domain and what that standing does, with no label', () => {
    expect(standingStart({ address: 'x@example.com' }, 'trusted')).toEqual({ by: 'from', value: 'x@example.com', facts: [], action: 'keep' });
    expect(standingStart({ address: 'x@example.com' }, 'unwanted')).toMatchObject({ action: 'archive' });
    expect(standingStart({ domain: 'example.net' }, 'blocked')).toEqual({ by: 'from', value: 'example.net', facts: [], action: 'spam' });
  });

  it('starts keeping mail that is what sift says, as a rule that waits for its label', () => {
    expect(keepStart('x@example.com', 'marketing')).toEqual({ by: 'from', value: 'x@example.com', facts: [], whenLabel: 'marketing', action: 'keep' });
  });

  it('names the rule adding would replace, the same one the write replaces', async () => {
    const { db } = await onePerson(ACCOUNT, 'work@example.org');
    const waiting = await addRule(db, ACCOUNT, { match: { from: 'x@example.com' }, whenLabel: 'newsletter' }, 'user');
    await addRule(db, ACCOUNT, { match: { from: 'x@example.com' }, except: [{ subjectContains: 'sale' }], disposition: 'keep' }, 'user');
    await addRule(db, 'work@example.org', { match: { from: 'x@example.com' }, disposition: 'spam' }, 'user');
    const mine = await addRule(db, ACCOUNT, { match: { from: 'x@example.com', facts: { isReply: false } }, labelId: 'newsletter' }, 'user');
    const rules = await listRuleSummaries(db, await everything(db));

    expect(replacedBy(rules, ACCOUNT, { facts: { isReply: false }, from: 'x@example.com' }, null)?.id).toBe(mine);
    expect(replacedBy(rules, ACCOUNT, { from: 'x@example.com' }, null)).toBeUndefined();
    expect(await setRule(db, ACCOUNT, { facts: { isReply: false }, from: 'x@example.com' }, { disposition: 'archive' }, 'user')).toBe(mine);
    expect(replacedBy(rules, ACCOUNT, { from: 'x@example.com' }, 'newsletter')?.id).toBe(waiting);
    expect(replacedBy(rules, ACCOUNT, { from: 'x@example.com' }, 'marketing')).toBeUndefined();
    expect(await setRule(db, ACCOUNT, { from: 'x@example.com' }, { whenLabel: 'newsletter', disposition: 'keep' }, 'user')).toBe(waiting);
  });
});

describe('making a rule from the dashboard', () => {
  it('always goes through the rule dialog, so the user sees the rule and agrees before it is added', () => {
    const pages = globSync('web/src/**/*.{ts,tsx}').filter((file) => file !== 'web/src/lib/api.ts');
    const adding = pages.filter((file) => readFileSync(file, 'utf8').includes('api.addRule('));
    expect(adding).toEqual(['web/src/views/rule-dialog.tsx']);
    // An answer's other scopes make a rule on the server; the page answers for the message alone.
    const scopes = pages.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/scope: '(\w+)'/g)].map((m) => `${file}: ${m[1]}`));
    expect(scopes.filter((s) => !s.endsWith(': once'))).toEqual([]);
  });
});
