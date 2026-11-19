import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { askMail, summarizeThread } from '../src/learn/mail.ts';
import { createMailAsker } from '../src/model/ask.ts';
import { createSummarizer } from '../src/model/summarize.ts';
import { loadKeyring } from '../src/secrets.ts';
import { recordSync } from '../src/store/accounts.ts';
import { sealPart } from '../src/store/content.ts';
import { setMail } from '../src/store/preferences.ts';
import { mailBodies } from '../src/store/query.ts';
import { ASK_TOOL, type MailAsker, readMailFilter } from '../src/triage/mail-ask.ts';
import { SUMMARY_TOOL, type Summarizer, buildSummaryPrompt } from '../src/triage/mail-summary.ts';
import { FIND_TOOL } from '../src/triage/rule-draft.ts';
import { plain } from '../src/plain.ts';
import { personWith, raw } from './fixtures.ts';
import { SAMPLE_LABELS, facts } from './helpers.ts';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('../src/telemetry.ts', async (actual) => ({ ...(await actual<object>()), reportError }));

const ACCOUNT = 'me@example.com';
const KEYS = loadKeyring({ SIFT_KEY: 'mail-ai-key' });
const LABELS = SAMPLE_LABELS.filter((l) => l.id === 'newsletter' || l.id === 'marketing');
const TODAY = '2026-11-19';
const BLANK = { reading: '', from: [], domains: [], label: '', view: '', unread: false, since: '', subject: [], note: '' };
const FOUND = [{ address: 'billing@vendor.example.org', name: 'Vendor', listId: null, messages: 3, label: null, subject: 'Your invoice' }];
const usage = { model: 'p/m', inputTokens: 10, outputTokens: 20, costUsd: 0.01 };

function faux() {
  const provider = fauxProvider();
  const models = createModels();
  models.setProvider(provider.provider);
  return { provider, complete: vi.spyOn(models, 'completeSimple'), models, model: provider.getModel() };
}

describe('the filter the model makes', () => {
  const read = (args: Record<string, unknown>, found = FOUND) => {
    const result = readMailFilter({ ...BLANK, ...args }, { labels: LABELS, today: TODAY }, found);
    return 'answer' in result ? result.answer : result;
  };

  it('holds only what the list narrows by, with a label by its id and a day no later than today', () => {
    expect(
      read({
        from: ['Billing@Vendor.example.org'],
        domains: ['@vendor.example.org'],
        label: 'newsletters',
        view: 'needs me',
        unread: true,
        since: '2026-11-01',
        subject: [' invoice ', 'invoice', ''],
        note: 'Sift does not know what you answered.',
      }),
    ).toEqual({
      filter: {
        from: ['billing@vendor.example.org'],
        domain: ['vendor.example.org'],
        label: 'newsletter',
        view: 'needs',
        unread: true,
        since: '2026-11-01',
        subject: ['invoice'],
      },
      note: 'Sift does not know what you answered.',
    });
    expect(read({ label: 'Receipts' })).toEqual({ unusable: '`label` is not one of theirs' });
    expect(read({ since: '2026-12-01' })).toHaveProperty('unusable');
    expect(read({ since: '2026-02-30' })).toHaveProperty('unusable');
  });

  it('refuses a sender no look-up returned, rather than narrow the list to a guess', () => {
    expect(read({ from: ['invented@vendor.example.org'] })).toEqual({
      unusable: `${FIND_TOOL} did not return invented@vendor.example.org: look the sender up, or leave them out`,
    });
    expect(read({ domains: ['example.net'] }, [])).toHaveProperty('unusable');
  });

  it('says in words why nothing narrows the list when the model made no filter', () => {
    expect(read({ note: 'The list cannot tell what you replied to.' })).toEqual({ cannot: 'The list cannot tell what you replied to.' });
    expect(read({})).toEqual({ cannot: 'Nothing in that narrows the list.' });
  });
});

describe('the model turning words into a filter', () => {
  const input = { words: 'invoices from vendors this month', today: TODAY, labels: LABELS };

  it('looks senders up, is given today and their labels, and narrows to what it found', async () => {
    const { provider, complete, models, model } = faux();
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall(FIND_TOOL, { query: 'invoice' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall(ASK_TOOL, { ...BLANK, domains: ['vendor.example.org'], since: '2026-11-01' })], { stopReason: 'toolUse' }),
    ]);
    const asked: string[] = [];
    const answer = await createMailAsker(models, model, 'low')(input, async (query) => (asked.push(query), FOUND));
    expect(answer).toMatchObject({ filter: { domain: ['vendor.example.org'], since: '2026-11-01' }, lookups: 1 });
    expect(asked).toEqual(['invoice']);
    const prompt = JSON.stringify(complete.mock.calls[0]?.[1].messages[0]?.content);
    expect(prompt).toContain(TODAY);
    expect(prompt).toContain('Newsletters');
    expect(complete.mock.calls[0]?.[1].tools?.map((t) => t.name)).toEqual([FIND_TOOL, ASK_TOOL]);
  });

  it('sends back a sender it made up, once, and fails when it makes one up again', async () => {
    const { provider, complete, models, model } = faux();
    const invented = fauxToolCall(ASK_TOOL, { ...BLANK, from: ['ap@vendor.example.org'] });
    provider.setResponses([
      fauxAssistantMessage([invented], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall(ASK_TOOL, { ...BLANK, from: ['ap@vendor.example.org'] })], { stopReason: 'toolUse' }),
    ]);
    expect(await createMailAsker(models, model, 'low')(input, async () => FOUND)).toMatchObject({
      failed: expect.stringContaining('did not return ap@vendor.example.org'),
    });
    expect(complete.mock.calls[1]?.[1].messages.at(-1)).toMatchObject({ role: 'toolResult', toolCallId: invented.id, isError: true });
  });

  it('asks once more when the model answers in words', async () => {
    const { provider, models, model } = faux();
    provider.setResponses([
      fauxAssistantMessage([fauxText('You want invoices.')]),
      fauxAssistantMessage([fauxToolCall(ASK_TOOL, { ...BLANK, subject: ['invoice'] })], { stopReason: 'toolUse' }),
    ]);
    expect(await createMailAsker(models, model, 'low')(input, async () => [])).toMatchObject({ filter: { subject: ['invoice'] }, lookups: 0 });
  });
});

describe('asking Inbox in words', () => {
  it('records the call with what it cost, its words and answer encrypted, after looking up only the person’s senders', async () => {
    const { db } = await personWith(KEYS, ACCOUNT);
    await recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: 'm1', from: { address: 'billing@vendor.example.org', domain: 'vendor.example.org' } })],
      '2',
    );
    const ask: MailAsker = async (given, find) => {
      expect(given).toMatchObject({ words: 'Vendor bills', today: TODAY });
      expect((await find('vendor')).map((s) => s.address)).toEqual(['billing@vendor.example.org']);
      return { filter: { from: ['billing@vendor.example.org'] }, usage, lookups: 1 };
    };
    expect(await askMail({ db, ask, model: 'p/m', now: () => 5 }, { accountId: ACCOUNT, words: 'Vendor bills', today: TODAY })).toEqual({
      filter: { from: ['billing@vendor.example.org'] },
    });
    const row = await raw(db).get('SELECT * FROM mail_asks');
    expect(row).toMatchObject({ model: 'p/m', started_at: 5, finished_at: 5, lookups: 1, input_tokens: 10, cost_usd: 0.01, error: null });
    expect(JSON.stringify(row)).not.toContain('endor');
  });

  it('records a failed call and refuses with what went wrong', async () => {
    const { db } = await personWith(KEYS, ACCOUNT);
    const failing: MailAsker = async () => ({ failed: 'rate limited', usage, lookups: 0 });
    await expect(askMail({ db, ask: failing, model: 'p/m' }, { accountId: ACCOUNT, words: 'x', today: TODAY })).rejects.toThrow('rate limited');
    expect(reportError).toHaveBeenCalledWith(new Error('Asking failed: rate limited'));
    expect(await raw(db).all('SELECT error, answer, cost_usd FROM mail_asks')).toEqual([{ error: 'rate limited', answer: null, cost_usd: 0.01 }]);
  });
});

describe('the conversation the model summarizes', () => {
  it('is each message’s own words, oldest first, keeping the newest when it is long', () => {
    const prompt = buildSummaryPrompt({
      subject: 'Lunch?',
      messages: [
        { from: 'Ada <ada@example.org>', receivedAt: 0, text: 'Old '.repeat(3000) },
        { from: 'Ada <ada@example.org>', receivedAt: 1, text: 'w'.repeat(4000) },
        { from: 'Ada <ada@example.org>', receivedAt: 1, text: 'x'.repeat(4000) },
        { from: 'Ada <ada@example.org>', receivedAt: 2, text: 'y'.repeat(4000) },
        { from: 'Ada <ada@example.org>', receivedAt: 3, text: 'z'.repeat(4000) },
        { from: 'Ada <ada@example.org>', receivedAt: 4, text: 'Thursday works.\n> When are you free?\n>> Lunch?' },
      ],
    });
    expect(prompt).toContain('Thursday works.');
    expect(prompt).not.toContain('When are you free?');
    expect(prompt).toContain('(1 older message left out)');
    expect(prompt).not.toContain('Old');
  });
});

describe('summarizing a conversation', () => {
  async function conversation() {
    const { db } = await personWith(KEYS, ACCOUNT);
    const ada = { address: 'ada@example.org', domain: 'example.org', name: 'Ada' };
    await recordSync(
      db,
      ACCOUNT,
      [
        facts({ accountId: ACCOUNT, messageId: 'q', threadId: 'lunch', from: ada, subject: 'Lunch?', receivedAt: 1 }),
        facts({ accountId: ACCOUNT, messageId: 'r', threadId: 'lunch', from: ada, subject: 'Re: Lunch?', receivedAt: 2 }),
      ],
      '2',
    );
    await setMail(db, true);
    for (const [id, text] of [
      ['q', 'Lunch on Thursday?'],
      ['r', 'Please confirm by Wednesday.'],
    ] as const)
      await db.insert(mailBodies).values({ accountId: ACCOUNT, messageId: id, bodyText: sealPart(db, ACCOUNT, id, 'text', text)!, fetchedAt: 0 });
    return db;
  }

  it('asks the model once with the text Sift holds, records it encrypted with its cost, and shows the recorded one while nothing new came', async () => {
    const db = await conversation();
    const { provider, complete, models, model } = faux();
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall(SUMMARY_TOOL, { summary: ' Ada asks you to lunch on Thursday.  Confirm by Wednesday. ' })], { stopReason: 'toolUse' }),
    ]);
    const deps = { db, summarize: createSummarizer(models, model, 'low'), model: 'faux/m', now: () => 9 };
    const first = await summarizeThread(deps, { accountId: ACCOUNT, threadId: 'lunch' });
    expect(plain(first)).toMatchObject({ newestId: 'r', at: 9, summary: 'Ada asks you to lunch on Thursday. Confirm by Wednesday.', failed: false });
    const shown = JSON.stringify(complete.mock.calls[0]?.[1].messages[0]?.content);
    expect(shown).toContain('Please confirm by Wednesday.');
    expect(shown).toContain('Ada <ada@example.org>');
    expect(complete.mock.calls[0]?.[1].tools?.map((t) => t.name)).toEqual([SUMMARY_TOOL]);
    const row = await raw(db).get('SELECT * FROM mail_summaries');
    expect(row).toMatchObject({ thread_id: 'lunch', newest_id: 'r', model: 'faux/m', error: null });
    expect(JSON.stringify(row)).not.toContain('Thursday');

    expect(plain(await summarizeThread(deps, { accountId: ACCOUNT, threadId: 'lunch' })).summary).toBe(first.summary);
    expect(complete).toHaveBeenCalledTimes(1);

    // Turning Inbox off takes what it said with the mail it said it of; what it cost stays.
    await setMail(db, false);
    expect(await raw(db).all('SELECT summary, newest_id FROM mail_summaries')).toEqual([{ summary: null, newest_id: 'r' }]);
  });

  it('asks again once the conversation has a newer message', async () => {
    const db = await conversation();
    const answers = ['First.', 'Second.'];
    const summarize: Summarizer = async () => ({ summary: answers.shift()!, usage });
    await summarizeThread({ db, summarize, model: 'p/m' }, { accountId: ACCOUNT, threadId: 'lunch' });
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 's', threadId: 'lunch', receivedAt: 3 })], '3');
    expect(plain(await summarizeThread({ db, summarize, model: 'p/m' }, { accountId: ACCOUNT, threadId: 'lunch' }))).toMatchObject({
      newestId: 's',
      summary: 'Second.',
    });
  });

  it('records a failed call and refuses, and refuses a conversation it holds no text of without calling', async () => {
    const db = await conversation();
    const failing: Summarizer = async () => ({ failed: 'timed out', usage });
    await expect(summarizeThread({ db, summarize: failing, model: 'p/m' }, { accountId: ACCOUNT, threadId: 'lunch' })).rejects.toThrow('timed out');
    expect(await raw(db).all('SELECT error, summary, cost_usd FROM mail_summaries')).toEqual([{ error: 'timed out', summary: null, cost_usd: 0.01 }]);

    const never: Summarizer = async () => {
      throw new Error('called');
    };
    await expect(summarizeThread({ db, summarize: never, model: 'p/m' }, { accountId: ACCOUNT, threadId: 'nothing' })).rejects.toThrow('none of this');
  });
});
