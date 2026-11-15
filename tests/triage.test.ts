import { describe, expect, it } from 'vitest';
import { bulkSignals, parseAddress } from '../src/triage/features.ts';
import { triage } from '../src/triage/pipeline.ts';
import { classifierStage } from '../src/triage/stages/classifier.ts';
import { type Rule, rulesStage } from '../src/triage/stages/rules.ts';
import { senderStage } from '../src/triage/stages/sender.ts';
import { facts } from './helpers.ts';

describe('pipeline', () => {
  it('sends a message to review when every stage abstains', async () => {
    const decision = await triage([rulesStage([]), senderStage(() => null)], facts());
    expect(decision).toMatchObject({ disposition: 'review', stage: 'fallback', subscription: 'preserve' });
  });

  it('stops at the first stage that decides', async () => {
    let classifierCalls = 0;
    const classifier = classifierStage(
      async () => {
        classifierCalls++;
        return { disposition: 'keep', confidence: 1 };
      },
      { minConfidence: 0.9, minSpamConfidence: 0.99 },
    );
    const rules = rulesStage([{ id: 'r1', match: { fromDomain: 'example.com' }, disposition: 'archive', label: 'sift/newsletters' }]);
    const decision = await triage([rules, classifier], facts());
    expect(decision).toMatchObject({ disposition: 'archive', stage: 'rules', ruleId: 'r1', label: 'sift/newsletters' });
    expect(classifierCalls).toBe(0);
  });
});

describe('rules stage', () => {
  const archiveDomain: Rule = { id: 'archive', match: { fromDomain: 'example.com' }, disposition: 'archive' };

  it('requires every condition in a match', async () => {
    const rule: Rule = { id: 'r', match: { fromDomain: 'example.com', subjectContains: 'invoice' }, disposition: 'archive' };
    expect(await rulesStage([rule]).decide(facts())).toBeNull();
    expect(await rulesStage([rule]).decide(facts({ subject: 'Your INVOICE' }))).toMatchObject({ ruleId: 'r' });
  });

  it('never matches an empty match', async () => {
    expect(await rulesStage([{ id: 'r', match: {}, disposition: 'archive' }]).decide(facts())).toBeNull();
  });

  it('lets a keep rule beat an earlier archive rule', async () => {
    const keep: Rule = { id: 'keep', match: { from: 'news@example.com' }, disposition: 'keep' };
    expect(await rulesStage([archiveDomain, keep]).decide(facts())).toMatchObject({ disposition: 'keep', ruleId: 'keep' });
  });

  it('skips a rule when an exception matches', async () => {
    const rule: Rule = { ...archiveDomain, except: [{ subjectContains: 'receipt' }] };
    expect(await rulesStage([rule]).decide(facts({ subject: 'Your receipt' }))).toBeNull();
  });

  it('matches To but not Cc', async () => {
    const rule: Rule = { id: 'r', match: { to: 'jobs@example.org' }, disposition: 'archive' };
    const cc = facts({ cc: [{ address: 'jobs@example.org', domain: 'example.org' }] });
    expect(await rulesStage([rule]).decide(cc)).toBeNull();
  });

  it('matches on List-Id', async () => {
    const rule: Rule = { id: 'r', match: { listId: 'dev.lists.example.com' }, disposition: 'archive' };
    const listed = facts({ headers: { 'list-id': 'Dev List <dev.lists.example.com>' } });
    expect(await rulesStage([rule]).decide(listed)).toMatchObject({ ruleId: 'r' });
  });
});

describe('sender stage', () => {
  it('abstains instead of hiding a sender the user has written to', async () => {
    const stage = senderStage(() => ({ disposition: 'archive', userHasReplied: true }));
    expect(await stage.decide(facts())).toBeNull();
  });

  it('applies a learned disposition', async () => {
    const stage = senderStage(() => ({ disposition: 'archive', label: 'sift/marketing', userHasReplied: false }));
    expect(await stage.decide(facts())).toMatchObject({ disposition: 'archive', label: 'sift/marketing', stage: 'sender' });
  });
});

describe('classifier stage', () => {
  const options = { minConfidence: 0.9, minSpamConfidence: 0.99 };

  it('abstains below the confidence bar', async () => {
    const stage = classifierStage(async () => ({ disposition: 'archive', confidence: 0.8 }), options);
    expect(await stage.decide(facts())).toBeNull();
  });

  it('holds spam to the higher bar', async () => {
    const stage = classifierStage(async () => ({ disposition: 'spam', confidence: 0.95 }), options);
    expect(await stage.decide(facts())).toBeNull();
  });

  it('abstains when the classifier errors', async () => {
    expect(await classifierStage(async () => null, options).decide(facts())).toBeNull();
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
