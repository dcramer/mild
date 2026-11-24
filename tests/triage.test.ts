import { describe, expect, it } from 'vitest';
import { bulkSignals, parseAddress } from '../src/triage/features.ts';
import { triage } from '../src/triage/pipeline.ts';
import { classifierStage } from '../src/triage/stages/classifier.ts';
import { deriveFacts } from '../src/triage/facts.ts';
import { rulesStage, settle } from '../src/triage/stages/rules.ts';
import { type Rule, describeMatch, readsMessage, specificity } from '../src/triage/rule.ts';
import { labelled } from '../src/triage/types.ts';
import { facts, SAMPLE_LABELS, email } from './helpers.ts';

const LABELS = SAMPLE_LABELS;

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
    const rules = rulesStage([{ id: 'r1', match: { fromDomain: ['example.com'] }, labelId: 'newsletter' }], LABELS);
    const decision = await triage([rules, classifier], facts());
    expect(decision).toMatchObject({ disposition: 'archive', stage: 'rules', ruleId: 'r1', labelId: 'newsletter', gmailLabel: 'mild/newsletters' });
    expect(classifierCalls).toBe(0);
  });
});

describe('rules stage', () => {
  const newsletters: Rule = { id: 'archive', match: { fromDomain: ['example.com'] }, labelId: 'newsletter' };
  const decide = (rules: Rule[], input = facts(), options = {}) => rulesStage(rules, LABELS, options).decide(input);

  it('names a label, and the label decides what happens', async () => {
    expect(await decide([newsletters])).toMatchObject({
      labelId: 'newsletter',
      gmailLabel: 'mild/newsletters',
      disposition: 'archive',
      reason: 'rule: from domain example.com is Newsletters',
    });
    expect(await decide([{ id: 'r', match: { fromDomain: ['example.com'] }, labelId: 'cold_outreach' }])).toMatchObject({
      labelId: 'cold_outreach',
      disposition: 'archive',
    });
  });

  it("carries a label's extras: blocking with spam, marking read with keep and archive", async () => {
    const blocking = LABELS.map((l) => (l.id === 'phishing' ? { ...l, block: true } : l));
    const phishing = await rulesStage([{ id: 'r', match: { fromDomain: ['example.com'] }, labelId: 'phishing' }], blocking).decide(facts());
    expect(phishing).toMatchObject({ disposition: 'spam', block: true });
    // The user's own exception replaces the label's action, block included.
    expect(
      await rulesStage([{ id: 'r', match: { fromDomain: ['example.com'] }, labelId: 'phishing', disposition: 'spam' }], blocking).decide(facts()),
    ).not.toHaveProperty('block');

    const read = LABELS.map((l) => (l.id === 'newsletter' ? { ...l, markRead: true, block: true } : l));
    const archived = await rulesStage([newsletters], read).decide(facts());
    expect(archived).toMatchObject({ disposition: 'archive', markRead: true });
    expect(archived).not.toHaveProperty('block');
  });

  it("puts a digest label's mail in the digest only when nothing replaced its action", async () => {
    const digesting = LABELS.map((l) => (l.id === 'newsletter' ? { ...l, digest: true } : l));
    expect(await rulesStage([newsletters], digesting).decide(facts())).toMatchObject({ disposition: 'archive', digest: true });
    for (const disposition of ['archive', 'keep'] as const)
      expect(await rulesStage([{ ...newsletters, disposition }], digesting).decide(facts())).not.toHaveProperty('digest');
  });

  it("lets a rule's own action beat its label's", async () => {
    expect(await decide([{ ...newsletters, disposition: 'keep' }])).toMatchObject({
      labelId: 'newsletter',
      gmailLabel: 'mild/newsletters',
      disposition: 'keep',
    });
  });

  it('ignores a rule whose label no longer exists', async () => {
    expect(await decide([{ id: 'r', match: { fromDomain: ['example.com'] }, labelId: 'gone' }, newsletters])).toMatchObject({ ruleId: 'archive' });
  });

  it('requires every condition in a match', async () => {
    const rule: Rule = { id: 'r', match: { fromDomain: ['example.com'], subjectContains: ['invoice'] }, labelId: 'transactional' };
    expect(await decide([rule])).toBeNull();
    expect(await decide([rule], facts({ subject: 'Your INVOICE' }))).toMatchObject({ ruleId: 'r' });
  });

  it('takes any one of several values for a condition, an address and a domain as one, and still needs every condition', async () => {
    const rule: Rule = {
      id: 'r',
      match: { from: ['shop@example.net'], fromDomain: ['example.com'], subjectContains: ['receipt', 'invoice'] },
      labelId: 'transactional',
    };
    const from = (address: string, subject: string) => facts({ from: email(address), subject });
    expect(await decide([rule], from('news@example.com', 'Your INVOICE'))).toMatchObject({ ruleId: 'r' });
    expect(await decide([rule], from('shop@example.net', 'A receipt'))).toMatchObject({ ruleId: 'r' });
    expect(await decide([rule], from('other@example.net', 'A receipt'))).toBeNull();
    expect(await decide([rule], from('news@example.com', 'Weekly digest'))).toBeNull();
    expect(describeMatch(rule.match)).toBe('from shop@example.net or domain example.com, subject contains receipt or invoice');
    expect(await decide([{ ...rule, name: 'Shop receipts' }], from('shop@example.net', 'A receipt'))).toMatchObject({
      reason: 'rule: Shop receipts is Receipts',
    });
    expect(specificity(rule.match)).toBe(specificity({ fromDomain: ['example.com'], subjectContains: ['receipt'] }));
  });

  it('never matches an empty match', async () => {
    expect(await decide([{ id: 'r', match: {}, labelId: 'newsletter' }])).toBeNull();
  });

  it('lets a rule that keeps mail beat an earlier one that archives it', async () => {
    const keep: Rule = { id: 'keep', match: { from: ['news@example.com'] }, labelId: 'personal' };
    expect(await decide([newsletters, keep])).toMatchObject({ disposition: 'keep', ruleId: 'keep' });
  });

  it('skips a rule when an exception matches', async () => {
    expect(await decide([{ ...newsletters, except: [{ subjectContains: ['receipt'] }] }], facts({ subject: 'Your receipt' }))).toBeNull();
  });

  describe("the sender's name", () => {
    const from = (name?: string) => facts({ from: { address: 'notifications@example.com', domain: 'example.com', ...(name === undefined ? {} : { name }) } });
    const updates: Rule = { id: 'updates', match: { from: ['notifications@example.com'], fromName: ['dependabot'] }, labelId: 'newsletter' };
    const bots: Rule = { id: 'bots', match: { fromDomain: ['example.com'], fromNameContains: ['[bot]'] }, labelId: 'newsletter' };

    it('matches a whole name or part of one, ignoring case and runs of spaces', async () => {
      expect(await decide([updates], from('  Dependabot '))).toMatchObject({ ruleId: 'updates' });
      expect(await decide([updates], from('Dependabot Preview'))).toBeNull();
      expect(await decide([updates], from())).toBeNull();
      expect(await decide([bots], from('github-actions[BOT]'))).toMatchObject({ ruleId: 'bots' });
      expect(await decide([{ ...bots, match: { fromDomain: ['example.com'], fromNameContains: ['release  team'] } }], from('The Release Team'))).toMatchObject({
        ruleId: 'bots',
      });
    });

    it('never holds a name without the address or domain it comes from', async () => {
      expect(await decide([{ id: 'r', match: { fromName: ['Dependabot'] }, disposition: 'keep' }], from('Dependabot'))).toBeNull();
      expect(await decide([{ id: 'r', match: { fromNameContains: ['bot'], facts: { isReply: false } }, disposition: 'keep' }], from('Dependabot'))).toBeNull();
      // An exception belongs to a rule that names the sender.
      expect(
        await decide(
          [{ id: 'r', match: { from: ['notifications@example.com'] }, except: [{ fromName: ['Dependabot'] }], labelId: 'newsletter' }],
          from('Dependabot'),
        ),
      ).toBeNull();
    });

    it('beats a rule for all their mail, and a whole name beats part of one', async () => {
      const all: Rule = { id: 'all', match: { from: ['notifications@example.com'] }, labelId: 'newsletter', disposition: 'archive' };
      const security: Rule = { id: 'security', match: { from: ['notifications@example.com'], fromNameContains: ['security'] }, labelId: 'personal' };
      expect(await decide([all, security], from('Security alerts'))).toMatchObject({ ruleId: 'security', disposition: 'keep' });
      expect(await decide([all, security], from('Dependabot'))).toMatchObject({ ruleId: 'all' });
      expect(specificity({ from: ['a@example.com'], fromName: ['A'] })).toBeGreaterThan(specificity({ from: ['a@example.com'], fromNameContains: ['A'] }));
      expect(describeMatch(updates.match)).toBe('from notifications@example.com, named dependabot');
    });
  });

  it('matches To but not Cc', async () => {
    const rule: Rule = { id: 'r', match: { to: ['jobs@example.org'] }, labelId: 'cold_outreach' };
    expect(await decide([rule], facts({ cc: [email('jobs@example.org')] }))).toBeNull();
  });

  it('matches on List-Id', async () => {
    const rule: Rule = { id: 'r', match: { listId: ['dev.lists.example.com'] }, labelId: 'newsletter' };
    expect(await decide([rule], facts({ headers: { 'list-id': 'Dev List <dev.lists.example.com>' } }))).toMatchObject({ ruleId: 'r' });
  });

  it('never hides mail from someone the owner has written to on a rule Mild learned, but does on one the user made', async () => {
    const written = { hasWritten: () => true };
    expect(await decide([{ ...newsletters, learned: true }], facts(), written)).toBeNull();
    expect(await decide([{ ...newsletters, learned: true }], facts(), { hasWritten: () => undefined })).toMatchObject({
      disposition: 'archive',
      reason: 'learned: from domain example.com is Newsletters',
    });
    expect(await decide([{ id: 'k', match: { fromDomain: ['example.com'] }, labelId: 'personal', learned: true }], facts(), written)).toMatchObject({
      disposition: 'keep',
    });
    expect(await decide([newsletters], facts(), written)).toMatchObject({ disposition: 'archive' });
  });
});

describe('rules on facts', () => {
  const decide = (rules: Rule[], input = facts()) => rulesStage(rules, LABELS).decide(input);
  const campaign = facts({
    headers: {
      'list-id': '<news.example.com>',
      'list-unsubscribe': '<https://example.com/u>',
      'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
      'authentication-results': 'mx.google.com; dmarc=pass header.from=example.com',
    },
  });
  const reply = facts({ headers: { 'in-reply-to': '<a@example.com>' } });

  it('reads the facts recorded for the message, or its headers when none are', async () => {
    const rule: Rule = { id: 'r', match: { facts: { unsubscribe: 'one-click', dmarc: 'pass' } }, labelId: 'newsletter' };
    expect(await decide([rule], campaign)).toMatchObject({ ruleId: 'r', reason: 'rule: has a one-click unsubscribe, passed DMARC is Newsletters' });
    expect(await decide([rule], reply)).toBeNull();
    // What was recorded stands, though the headers alone would not show it.
    const known = { ...deriveFacts(reply), unsubscribe: 'one-click' as const, dmarc: 'pass' as const };
    expect(await decide([rule], { ...reply, known })).toMatchObject({ ruleId: 'r' });
  });

  it('takes a list of answers, and whether a named fact is there at all', async () => {
    const unproven: Rule = { id: 'u', match: { facts: { dmarc: ['fail', 'none'] } }, labelId: 'cold_outreach' };
    expect(await decide([unproven], reply)).toMatchObject({ ruleId: 'u' });
    expect(await decide([unproven], campaign)).toBeNull();
    const listed: Rule = { id: 'l', match: { facts: { listId: true } }, disposition: 'archive' };
    expect(await decide([listed], campaign)).toMatchObject({ ruleId: 'l' });
    expect(await decide([listed], reply)).toBeNull();
  });

  it('never matches on what is not known yet, such as an attachment before the message is read', async () => {
    const rule: Rule = { id: 'a', match: { facts: { hasAttachments: true } }, labelId: 'transactional' };
    expect(await decide([rule])).toBeNull();
    expect(await decide([rule], facts({ known: { ...deriveFacts(facts()), hasAttachments: true } }))).toMatchObject({ ruleId: 'a' });
    expect(readsMessage(rule)).toBe(true);
    expect(readsMessage({ id: 'b', match: { facts: { isReply: true } }, disposition: 'keep' })).toBe(false);
  });

  it('needs the facts and every other condition to hold together, with exceptions on facts', async () => {
    const rule: Rule = { id: 'r', match: { fromDomain: ['example.com'], facts: { isReply: false } }, disposition: 'archive' };
    expect(await decide([rule], campaign)).toMatchObject({ ruleId: 'r' });
    expect(await decide([rule], reply)).toBeNull();
    expect(
      await decide([{ id: 'x', match: { fromDomain: ['example.com'] }, except: [{ facts: { isReply: true } }], disposition: 'archive' }], reply),
    ).toBeNull();
    expect(await decide([{ id: 'e', match: { facts: {} }, disposition: 'archive' }])).toBeNull();
  });

  it('ranks a fact below who sent it, and a sender with a fact above the sender alone', async () => {
    const domain: Rule = { id: 'domain', match: { fromDomain: ['example.com'] }, disposition: 'archive' };
    const replies: Rule = { id: 'replies', match: { facts: { isReply: true } }, labelId: 'newsletter' };
    const domainReplies: Rule = { id: 'both', match: { fromDomain: ['example.com'], facts: { isReply: true } }, labelId: 'cold_outreach' };
    expect(specificity(replies.match)).toBeLessThan(specificity(domain.match));
    expect(specificity(domainReplies.match)).toBeGreaterThan(specificity(domain.match));
    expect(await decide([replies, domain], reply)).toMatchObject({ ruleId: 'domain' });
    expect(await decide([domain, domainReplies], reply)).toMatchObject({ ruleId: 'both' });
  });

  it('says every fact in plain words', () => {
    expect(describeMatch({ from: ['a@example.com'], facts: { isReply: false, addressed: 'neither', category: 'promotions', listId: true } })).toBe(
      'from a@example.com, is not a reply, does not name you, is in Promotions, came through a mailing list',
    );
    expect(describeMatch({ facts: { unsubscribe: ['header', 'none'], hasAttachments: true } })).toBe('has no one-click unsubscribe, has attachments');
  });
});

describe('the three kinds of rule', () => {
  const from = { address: 'notifications@example.com', domain: 'example.com' };
  const mail = facts({ from });
  const decide = (rules: Rule[], options = {}) => rulesStage(rules, LABELS, options).decide(mail);
  const label = (id: string) => LABELS.find((l) => l.id === id)!;
  // What a model tier would say about the message.
  const said = (labelId: string) => ({ ...labelled(label(labelId)), stage: 'model' as const, reason: 'looks like one' });

  it('takes an action without saying what the mail is', async () => {
    const archive: Rule = { id: 'a', match: { from: [from.address] }, disposition: 'archive' };
    const decision = await decide([archive]);
    expect(decision).toMatchObject({
      disposition: 'archive',
      subscription: 'preserve',
      stage: 'rules',
      ruleId: 'a',
      reason: 'rule: from notifications@example.com: archive it',
    });
    expect(decision).not.toHaveProperty('labelId');
    expect(decision).not.toHaveProperty('gmailLabel');
    // Its own extras apply; there is no label whose extras could.
    expect(await decide([{ ...archive, markRead: true, subscription: 'unsubscribe' }])).toMatchObject({ markRead: true, subscription: 'unsubscribe' });
  });

  it('labels mail an action rule decides only when another rule already says what it is', async () => {
    const keep: Rule = { id: 'a', match: { from: [from.address] }, disposition: 'keep' };
    const named: Rule = { id: 'n', match: { fromDomain: [from.domain] }, labelId: 'newsletter' };
    // The action rule decides; the other names the label for nothing. Newsletters archives, the rule keeps.
    const decision = await decide([named, keep]);
    expect(decision).toMatchObject({ ruleId: 'a', disposition: 'keep', labelId: 'newsletter', gmailLabel: 'mild/newsletters' });
    // The label's extras are not the rule's to apply.
    expect(decision).toMatchObject({ subscription: 'preserve' });
  });

  it('leaves mail to the tier that names labels when its best rule waits for one, then applies it', async () => {
    const whenMarketing: Rule = { id: 'w', match: { from: [from.address] }, whenLabel: 'marketing', disposition: 'keep' };
    expect(await decide([whenMarketing], { judged: true })).toBeNull();
    // With no such tier the rule can never apply, and it does not pretend to.
    expect(await decide([whenMarketing])).toBeNull();

    expect(settle([whenMarketing], LABELS, mail, said('marketing'))).toMatchObject({
      disposition: 'keep',
      labelId: 'marketing',
      stage: 'model',
      ruleId: 'w',
      reason: 'rule: from notifications@example.com, when it is Marketing: keep it. looks like one',
    });
    // Anything else from them is as the tier said.
    expect(settle([whenMarketing], LABELS, mail, said('newsletter'))).toEqual(said('newsletter'));
  });

  it('falls back to the rule for all their mail when the label is not the one a narrower rule waits for', async () => {
    const archive: Rule = { id: 'a', match: { from: [from.address] }, disposition: 'archive' };
    const keepSecurity: Rule = { id: 'k', match: { from: [from.address] }, whenLabel: 'security', disposition: 'keep' };
    expect(await decide([archive, keepSecurity], { judged: true })).toBeNull();
    expect(settle([archive, keepSecurity], LABELS, mail, said('security'))).toMatchObject({ ruleId: 'k', disposition: 'keep', labelId: 'security' });
    // The tier's label stays on mail the action rule then archives.
    expect(settle([archive, keepSecurity], LABELS, mail, said('personal'))).toMatchObject({ ruleId: 'a', disposition: 'archive', labelId: 'personal' });
    // Without a tier to ask, the rule that needs none decides.
    expect(await decide([archive, keepSecurity])).toMatchObject({ ruleId: 'a', disposition: 'archive' });
  });

  it("confirms a label's own action when a rule waits for the label and says nothing else", () => {
    const rule: Rule = { id: 'w', match: { from: [from.address] }, whenLabel: 'newsletter' };
    expect(settle([rule], LABELS, mail, { ...said('newsletter'), disposition: 'review' })).toMatchObject({
      ruleId: 'w',
      disposition: 'archive',
      labelId: 'newsletter',
    });
  });

  it('does not touch a decision with no label, or one a rule made', () => {
    const archive: Rule = { id: 'a', match: { from: [from.address] }, disposition: 'archive' };
    const unsure = { disposition: 'review' as const, subscription: 'preserve' as const, stage: 'model' as const, reason: 'unsure' };
    expect(settle([archive], LABELS, mail, unsure)).toEqual(unsure);
    const ruled = { ...said('marketing'), stage: 'rules' as const, ruleId: 'x' };
    expect(settle([archive], LABELS, mail, ruled)).toEqual(ruled);
  });

  it('lets a rule that keeps all their mail beat one that waits for a label', async () => {
    const trust: Rule = { id: 't', match: { fromDomain: [from.domain] }, disposition: 'keep' };
    const whenMarketing: Rule = { id: 'w', match: { from: [from.address] }, whenLabel: 'marketing', disposition: 'archive' };
    expect(await decide([trust, whenMarketing], { judged: true })).toMatchObject({ ruleId: 't', disposition: 'keep' });
  });
});

describe('classifier stage', () => {
  const options = { minConfidence: 0.9, minSpamConfidence: 0.99 };
  const spam = [...LABELS, { id: 'scam', name: 'Scam', description: '', disposition: 'spam' as const, gmailLabel: 'mild/scam' }];

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
