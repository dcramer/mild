import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS } from '../src/store/labels.ts';
import { bulkSignals, parseAddress } from '../src/triage/features.ts';
import { triage } from '../src/triage/pipeline.ts';
import { classifierStage } from '../src/triage/stages/classifier.ts';
import { type Rule, rulesStage } from '../src/triage/stages/rules.ts';
import { facts } from './helpers.ts';

const LABELS = DEFAULT_LABELS;

describe('pipeline', () => {
  it('sends a message to review when every stage abstains', async () => {
    const decision = await triage([rulesStage([], LABELS)], facts());
    expect(decision).toMatchObject({ disposition: 'review', stage: 'fallback', subscription: 'preserve' });
    expect(decision.labelId).toBeUndefined();
  });

  it('stops at the first stage that decides', async () => {
    let classifierCalls = 0;
    const classifier = classifierStage(
      async () => {
        classifierCalls++;
        return { labelId: 'personal', confidence: 1 };
      },
      LABELS,
      { minConfidence: 0.9, minSpamConfidence: 0.99 },
    );
    const rules = rulesStage([{ id: 'r1', match: { fromDomain: 'example.com' }, labelId: 'newsletter' }], LABELS);
    const decision = await triage([rules, classifier], facts());
    expect(decision).toMatchObject({ disposition: 'archive', stage: 'rules', ruleId: 'r1', labelId: 'newsletter', gmailLabel: 'sift/newsletters' });
    expect(classifierCalls).toBe(0);
  });
});

describe('rules stage', () => {
  const newsletters: Rule = { id: 'archive', match: { fromDomain: 'example.com' }, labelId: 'newsletter' };
  const decide = (rules: Rule[], input = facts(), options = {}) => rulesStage(rules, LABELS, options).decide(input);

  it('names a label, and the label decides what happens', async () => {
    expect(await decide([newsletters])).toMatchObject({
      labelId: 'newsletter',
      gmailLabel: 'sift/newsletters',
      disposition: 'archive',
      reason: 'rule: from domain example.com is Newsletters',
    });
    const asks = await decide([{ id: 'r', match: { fromDomain: 'example.com' }, labelId: 'cold_outreach' }]);
    expect(asks).toMatchObject({ labelId: 'cold_outreach', disposition: 'review' });
  });

  it("lets a rule's own action beat its label's", async () => {
    expect(await decide([{ ...newsletters, disposition: 'keep' }])).toMatchObject({
      labelId: 'newsletter',
      gmailLabel: 'sift/newsletters',
      disposition: 'keep',
    });
  });

  it('ignores a rule whose label no longer exists', async () => {
    expect(await decide([{ id: 'r', match: { fromDomain: 'example.com' }, labelId: 'gone' }, newsletters])).toMatchObject({ ruleId: 'archive' });
  });

  it('requires every condition in a match', async () => {
    const rule: Rule = { id: 'r', match: { fromDomain: 'example.com', subjectContains: 'invoice' }, labelId: 'transactional' };
    expect(await decide([rule])).toBeNull();
    expect(await decide([rule], facts({ subject: 'Your INVOICE' }))).toMatchObject({ ruleId: 'r' });
  });

  it('never matches an empty match', async () => {
    expect(await decide([{ id: 'r', match: {}, labelId: 'newsletter' }])).toBeNull();
  });

  it('lets a rule that keeps mail beat an earlier one that archives it', async () => {
    const keep: Rule = { id: 'keep', match: { from: 'news@example.com' }, labelId: 'personal' };
    expect(await decide([newsletters, keep])).toMatchObject({ disposition: 'keep', ruleId: 'keep' });
  });

  it('skips a rule when an exception matches', async () => {
    expect(await decide([{ ...newsletters, except: [{ subjectContains: 'receipt' }] }], facts({ subject: 'Your receipt' }))).toBeNull();
  });

  it('matches To but not Cc', async () => {
    const rule: Rule = { id: 'r', match: { to: 'jobs@example.org' }, labelId: 'cold_outreach' };
    expect(await decide([rule], facts({ cc: [{ address: 'jobs@example.org', domain: 'example.org' }] }))).toBeNull();
  });

  it('matches on List-Id', async () => {
    const rule: Rule = { id: 'r', match: { listId: 'dev.lists.example.com' }, labelId: 'newsletter' };
    expect(await decide([rule], facts({ headers: { 'list-id': 'Dev List <dev.lists.example.com>' } }))).toMatchObject({ ruleId: 'r' });
  });

  it('never hides mail from someone the owner has written to on a rule sift learned, but does on one the user made', async () => {
    const written = { hasWritten: () => true };
    expect(await decide([{ ...newsletters, learned: true }], facts(), written)).toBeNull();
    expect(await decide([{ ...newsletters, learned: true }], facts(), { hasWritten: () => undefined })).toMatchObject({
      disposition: 'archive',
      reason: 'learned: from domain example.com is Newsletters',
    });
    expect(await decide([{ id: 'k', match: { fromDomain: 'example.com' }, labelId: 'personal', learned: true }], facts(), written)).toMatchObject({
      disposition: 'keep',
    });
    expect(await decide([newsletters], facts(), written)).toMatchObject({ disposition: 'archive' });
  });
});

describe('classifier stage', () => {
  const options = { minConfidence: 0.9, minSpamConfidence: 0.99 };
  const spam = [...LABELS, { id: 'scam', name: 'Scam', description: '', disposition: 'spam' as const, gmailLabel: 'sift/scam' }];

  it('names a label above the bar and abstains below it', async () => {
    expect(await classifierStage(async () => ({ labelId: 'newsletter', confidence: 0.95 }), LABELS, options).decide(facts())).toMatchObject({
      labelId: 'newsletter',
      disposition: 'archive',
      stage: 'classifier',
    });
    expect(await classifierStage(async () => ({ labelId: 'newsletter', confidence: 0.8 }), LABELS, options).decide(facts())).toBeNull();
  });

  it('holds a label that marks spam to the higher bar', async () => {
    expect(await classifierStage(async () => ({ labelId: 'scam', confidence: 0.95 }), spam, options).decide(facts())).toBeNull();
  });

  it('abstains when the classifier errors or names a label that does not exist', async () => {
    expect(await classifierStage(async () => null, LABELS, options).decide(facts())).toBeNull();
    expect(await classifierStage(async () => ({ labelId: 'gone', confidence: 1 }), LABELS, options).decide(facts())).toBeNull();
  });
});

describe('features', () => {
  it('detects RFC 8058 one-click unsubscribe only with an https target and the Post header', () => {
    const headers = { 'list-unsubscribe': '<mailto:u@example.com>, <https://example.com/u/abc>' };
    expect(bulkSignals(headers)).toMatchObject({ hasListUnsubscribe: true, oneClickUnsubscribeUrl: null });
    expect(bulkSignals({ ...headers, 'list-unsubscribe-post': 'List-Unsubscribe=One-Click' }).oneClickUnsubscribeUrl).toBe('https://example.com/u/abc');
    expect(
      bulkSignals({ 'list-unsubscribe': '<mailto:u@example.com>', 'list-unsubscribe-post': 'List-Unsubscribe=One-Click' }).oneClickUnsubscribeUrl,
    ).toBeNull();
  });

  it('reads precedence and auto-submitted', () => {
    expect(bulkSignals({ precedence: 'Bulk', 'auto-submitted': 'auto-generated' })).toMatchObject({ precedenceBulk: true, autoSubmitted: true });
    expect(bulkSignals({ 'auto-submitted': 'no' }).autoSubmitted).toBe(false);
  });

  it('parses addresses', () => {
    expect(parseAddress('"Ada L" <Ada@Example.COM>')).toEqual({ address: 'ada@example.com', domain: 'example.com', name: 'Ada L' });
    expect(parseAddress('ada@example.com')).toEqual({ address: 'ada@example.com', domain: 'example.com' });
    expect(parseAddress('undisclosed-recipients:;')).toBeNull();
  });
});
