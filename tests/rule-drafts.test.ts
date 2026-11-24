import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { draftRule } from '../src/learn/rules.ts';
import { createRuleDrafter } from '../src/model/draft-rule.ts';
import { loadKeyring } from '../src/secrets.ts';
import { recordSync } from '../src/store/messages.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { senderDirectory } from '../src/store/senders.ts';
import { FILL_TOOL, FIND_TOOL, type FoundSender, MAX_LOOKUPS, type RuleDrafter, readRuleDraft, searchSenders } from '../src/prompts/rule-draft.ts';
import { personWith, raw } from './fixtures.ts';
import { SAMPLE_LABELS, facts } from './helpers.ts';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('../src/telemetry.ts', async (actual) => ({ ...(await actual<object>()), reportError }));

const ACCOUNT = 'me@example.com';
const KEYS = loadKeyring({ MILD_KEY: 'draft-key' });
const LABELS = SAMPLE_LABELS.filter((l) => l.id === 'newsletter' || l.id === 'marketing');
const DOMAIN = [{ by: 'from', value: 'example.org' }];
const BLANK = {
  conditions: DOMAIN,
  facts: [],
  label: '',
  onlyOnceLabelled: false,
  when: '',
  action: 'archive',
  markRead: false,
  unsubscribe: false,
  note: '',
  name: '',
};

describe('the rule the model fills in', () => {
  const read = (args: Partial<typeof BLANK> | Record<string, unknown>) => {
    const result = readRuleDraft({ ...BLANK, ...args }, LABELS);
    return 'draft' in result ? result.draft : result;
  };

  const by = (...conditions: [string, string][]) => ({ conditions: conditions.map(([kind, value]) => ({ by: kind, value })) });

  it('takes an address as one sender and anything else as everyone at a domain, never one anyone can get an address at', () => {
    expect(read(by(['from', 'News@Example.org']))).toEqual({ match: { from: ['news@example.org'] }, disposition: 'archive' });
    expect(read(by(['from', '@example.org']))).toEqual({ match: { fromDomain: ['example.org'] }, disposition: 'archive' });
    expect(read(by(['from', 'gmail.com']))).toEqual({ unusable: '`from` is a domain anyone can get an address at; name the address' });
    expect(read(by(['from', 'not a domain']))).toEqual({ unusable: '`from` is neither an address nor a domain' });
  });

  it('holds several values of a kind as alternatives, and refuses the rule when one of them is not a rule’s', () => {
    expect(
      read(by(['from', 'example.org'], ['from', 'shop@example.net'], ['from', 'EXAMPLE.org'], ['subjectContains', 'receipt'], ['subjectContains', 'invoice'])),
    ).toEqual({
      match: { from: ['shop@example.net'], fromDomain: ['example.org'], subjectContains: ['receipt', 'invoice'] },
      disposition: 'archive',
    });
    expect(read({ ...by(['from', 'example.org'], ['from', 'example.net']), name: ' Example  mail ' })).toEqual({
      match: { fromDomain: ['example.org', 'example.net'] },
      name: 'Example mail',
      disposition: 'archive',
    });
    expect(read(by(['from', 'example.org'], ['from', 'gmail.com']))).toHaveProperty('unusable');
    expect(read(by(['from', 'example.org'], ['cc', 'me@example.com']))).toEqual({ unusable: 'a condition is of a kind a rule cannot hold' });
    expect(read(by(['from', 'example.org'], ['to', 'example.com']))).toEqual({ unusable: '`to` is not an address' });
    expect(read(by(['from', 'example.org'], ['subjectContains', ' ']))).toEqual({ unusable: 'a condition has no value' });
  });

  it('holds a name only beside an address or domain, and facts in the words they are offered in', () => {
    expect(
      read({ ...by(['from', 'example.org'], ['senderNameContains', 'Example  Deals']), facts: ['came through a mailing list', 'is not a reply', 'made up'] }),
    ).toEqual({
      match: { fromDomain: ['example.org'], fromNameContains: ['Example Deals'], facts: { listId: true, isReply: false } },
      disposition: 'archive',
    });
    expect(read({ conditions: [], facts: ['has a tracking pixel'] })).toEqual({ match: { facts: { trackingPixel: true } }, disposition: 'archive' });
    expect(read(by(['subjectContains', 'Weekly'], ['senderName', 'Example']))).toEqual({ unusable: "a sender's name counts only beside a `from`" });
    expect(read({ conditions: [] })).toEqual({ unusable: 'the rule names no condition, so it would match all mail' });
  });

  it('names a label by its id, and lets the label decide unless the rule waits for it', () => {
    expect(read({ label: 'newsletters', action: 'spam', markRead: true, unsubscribe: true, when: 'it is about a sale' })).toEqual({
      match: { fromDomain: ['example.org'] },
      label: 'newsletter',
      when: 'it is about a sale',
    });
    expect(read({ label: 'Newsletters', onlyOnceLabelled: true, action: 'keep', markRead: true, when: 'ignored' })).toEqual({
      match: { fromDomain: ['example.org'] },
      whenLabel: 'newsletter',
      disposition: 'keep',
      markRead: true,
    });
    expect(read({ label: 'Newsletters', onlyOnceLabelled: true, action: '' })).toEqual({ unusable: 'a rule that waits for a label needs an `action`' });
    expect(read({ label: 'Receipts' })).toEqual({ unusable: '`label` is not one of theirs' });
    expect(read({ action: '' })).toEqual({ unusable: 'a rule with no label needs an `action`' });
  });

  it('says what else is needed, and never marks spam read', () => {
    expect(read({ action: 'spam', markRead: true, unsubscribe: true, note: ' Add another\nfor example.net. ' })).toEqual({
      match: { fromDomain: ['example.org'] },
      disposition: 'spam',
      unsubscribe: true,
      note: 'Add another for example.net.',
    });
  });
});

describe('looking up senders', () => {
  const sender = (address: string, messages: number, more: Partial<FoundSender> = {}): FoundSender => ({
    address,
    name: null,
    listId: null,
    messages,
    label: null,
    subject: 'Hello',
    ...more,
  });

  it('finds them by any word in their name, address, list or newest subject, most words then most mail first', () => {
    const all = [
      sender('a@example.org', 1, { name: 'Example Rides' }),
      sender('b@example.org', 9, { subject: 'Your ride receipt' }),
      sender('c@example.net', 5, { listId: 'rides.example.net' }),
      sender('d@example.com', 50),
    ];
    expect(searchSenders(all, 'rides').map((s) => s.address)).toEqual(['c@example.net', 'a@example.org']);
    expect(searchSenders(all, 'example.org receipt').map((s) => s.address)).toEqual(['b@example.org', 'a@example.org']);
    expect(searchSenders(all, ' ')).toEqual([]);
  });

  it('lists everyone a mailbox has mail from, with their newest mail and the label it last got', async () => {
    const { db } = await personWith(KEYS, ACCOUNT);
    const from = { address: 'digest@example.org', domain: 'example.org', name: 'Example Digest' };
    await recordSync(
      db,
      ACCOUNT,
      [
        facts({ accountId: ACCOUNT, messageId: 'm1', from, subject: 'Older', receivedAt: 1 }),
        facts({ accountId: ACCOUNT, messageId: 'm2', from, subject: 'Newer', receivedAt: 2, headers: { 'list-id': 'Digest <digest.example.org>' } }),
        facts({ accountId: ACCOUNT, messageId: 'm3', receivedAt: 3 }),
      ],
      '2',
    );
    await recordDecision(db, ACCOUNT, 'm1', { disposition: 'archive', subscription: 'preserve', stage: 'model', labelId: 'newsletter', reason: 'r' });
    expect(await senderDirectory(db, [ACCOUNT])).toEqual([
      { address: 'digest@example.org', name: 'Example Digest', listId: 'digest.example.org', messages: 2, label: 'Newsletters', subject: 'Newer' },
      { address: 'news@example.com', name: null, listId: null, messages: 1, label: null, subject: 'Weekly digest' },
    ]);
  });
});

describe('the model filling in a rule', () => {
  function faux() {
    const provider = fauxProvider();
    const models = createModels();
    models.setProvider(provider.provider);
    return { provider, complete: vi.spyOn(models, 'completeSimple'), draft: createRuleDrafter(models, provider.getModel(), 'low') };
  }
  const input = { goal: 'Archive the Example digest', labels: LABELS };

  it('looks senders up, is shown what it found, and fills the rule in', async () => {
    const { provider, complete, draft } = faux();
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall(FIND_TOOL, { query: 'example digest' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall(FILL_TOOL, { ...BLANK, conditions: [{ by: 'listId', value: 'digest.example.org' }] })], { stopReason: 'toolUse' }),
    ]);
    const asked: string[] = [];
    const found = [
      { address: 'digest@example.org', name: 'Example Digest', listId: 'digest.example.org', messages: 2, label: 'Newsletters', subject: 'Newer' },
    ];
    const answer = await draft(input, async (query) => (asked.push(query), found));
    expect(answer).toMatchObject({
      draft: { match: { listId: ['digest.example.org'] }, disposition: 'archive' },
      lookups: 1,
      usage: { model: expect.stringContaining('/') },
    });
    expect(asked).toEqual(['example digest']);
    expect(complete.mock.calls[0]?.[1].tools?.map((t) => t.name)).toEqual([FIND_TOOL, FILL_TOOL]);
    const shown = complete.mock.calls[1]?.[1].messages.at(-1);
    expect(shown).toMatchObject({ role: 'toolResult', toolName: FIND_TOOL });
    expect(JSON.stringify(shown)).toContain('Example Digest <digest@example.org>, 2 messages, list digest.example.org, labelled Newsletters');
  });

  it(`stops offering look-ups after ${MAX_LOOKUPS}, and fails when no rule comes`, async () => {
    const { provider, complete, draft } = faux();
    provider.setResponses([
      ...Array.from({ length: MAX_LOOKUPS }, () => fauxAssistantMessage([fauxToolCall(FIND_TOOL, { query: 'x' })], { stopReason: 'toolUse' })),
      fauxAssistantMessage([fauxText('I could not find them.')]),
      fauxAssistantMessage([fauxText('Still nothing.')]),
    ]);
    expect(await draft(input, async () => [])).toMatchObject({ failed: 'the model did not fill in a rule', lookups: MAX_LOOKUPS });
    expect(complete.mock.calls.at(-1)?.[1].tools?.map((t) => t.name)).toEqual([FILL_TOOL]);
  });

  it('asks once more for the rule when the model answers in words', async () => {
    const { provider, complete, draft } = faux();
    provider.setResponses([
      fauxAssistantMessage([fauxText('You want the digest archived.')]),
      fauxAssistantMessage([fauxToolCall(FILL_TOOL, BLANK)], { stopReason: 'toolUse' }),
    ]);
    expect(await draft(input, async () => [])).toMatchObject({ draft: { match: { fromDomain: ['example.org'] }, disposition: 'archive' } });
    expect(complete.mock.calls[1]?.[1].messages.at(-1)).toMatchObject({ role: 'user', content: `Fill in the rule with ${FILL_TOOL}.` });
  });

  it('sends an unusable rule back once with what is wrong, then gives up saying why', async () => {
    const { provider, complete, draft } = faux();
    const shared = fauxToolCall(FILL_TOOL, { ...BLANK, conditions: [{ by: 'from', value: 'gmail.com' }] });
    provider.setResponses([
      fauxAssistantMessage([shared], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall(FILL_TOOL, { ...BLANK, conditions: [{ by: 'from', value: 'friend@gmail.com' }] })], { stopReason: 'toolUse' }),
    ]);
    expect(await draft(input, async () => [])).toMatchObject({ draft: { match: { from: ['friend@gmail.com'] } }, lookups: 0 });
    const told = complete.mock.calls[1]?.[1].messages.at(-1);
    expect(told).toMatchObject({ role: 'toolResult', toolName: FILL_TOOL, toolCallId: shared.id, isError: true });
    expect(JSON.stringify(told)).toContain('a domain anyone can get an address at');

    provider.setResponses([
      fauxAssistantMessage([fauxToolCall(FILL_TOOL, { ...BLANK, action: '' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall(FILL_TOOL, { ...BLANK, action: '' })], { stopReason: 'toolUse' }),
    ]);
    expect(await draft(input, async () => [])).toMatchObject({
      failed: 'the model did not fill in a usable rule: a rule with no label needs an `action`',
      lookups: 0,
    });
  });
});

describe('asking for a rule', () => {
  const person = async () => (await personWith(KEYS, ACCOUNT)).db;
  const usage = { model: 'p/m', inputTokens: 10, outputTokens: 20, costUsd: 0.01 };

  it('records the call with what it cost and how many look-ups it made, its words encrypted, and makes no rule', async () => {
    const db = await person();
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'm1', from: { address: 'hi@acme.example.org', domain: 'acme.example.org' } })], '2');
    const draft: RuleDrafter = async (given, find) => {
      expect(given.goal).toBe('Archive Acme');
      expect(given.labels.map((l) => l.id)).toContain('newsletter');
      expect((await find('acme')).map((s) => s.address)).toEqual(['hi@acme.example.org']);
      return { draft: { match: { fromDomain: ['acme.example.org'] }, disposition: 'archive' }, usage, lookups: 1 };
    };
    expect(await draftRule({ db, draft, model: 'p/m', now: () => 5 }, { accountId: ACCOUNT, goal: 'Archive Acme' })).toEqual({
      match: { fromDomain: ['acme.example.org'] },
      disposition: 'archive',
    });
    const row = await raw(db).get('SELECT * FROM rule_drafts');
    expect(row).toMatchObject({ model: 'p/m', started_at: 5, finished_at: 5, lookups: 1, input_tokens: 10, cost_usd: 0.01, error: null });
    expect(JSON.stringify(row)).not.toContain('acme');
    expect(JSON.stringify(row)).not.toContain('Acme');
    expect(await raw(db).all('SELECT id FROM rules')).toEqual([]);
  });

  it('records and reports a failed call, and refuses with what went wrong', async () => {
    const db = await person();
    const failing: RuleDrafter = async () => ({ failed: 'rate limited', usage, lookups: 0 });
    await expect(draftRule({ db, draft: failing, model: 'p/m' }, { accountId: ACCOUNT, goal: 'Archive Acme' })).rejects.toThrow('rate limited');
    expect(reportError).toHaveBeenCalledWith(new Error('Rule drafting failed: rate limited'));
    expect(await raw(db).all('SELECT error, rule, cost_usd FROM rule_drafts')).toEqual([{ error: 'rate limited', rule: null, cost_usd: 0.01 }]);
  });

  it('finishes the record of a call whose look-up threw', async () => {
    const db = await person();
    const throwing: RuleDrafter = async () => {
      throw new Error('lookup failed');
    };
    await expect(draftRule({ db, draft: throwing, model: 'p/m', now: () => 7 }, { accountId: ACCOUNT, goal: 'Archive Acme' })).rejects.toThrow('lookup failed');
    expect(await raw(db).all('SELECT error, finished_at FROM rule_drafts')).toEqual([{ error: 'lookup failed', finished_at: 7 }]);
  });
});
