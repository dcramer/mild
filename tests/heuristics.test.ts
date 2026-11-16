import { listUndecided } from '../src/store/messages.ts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../src/config.ts';
import { type RunOptions, runOnce } from '../src/daemon/run.ts';
import type { GmailApi, RawMessage } from '../src/gmail/api.ts';
import { addMailbox } from '../src/store/accounts.ts';
import { openUserDb, raw } from './fixtures.ts';
import { DEFAULT_LABELS } from '../src/store/labels.ts';
import { heuristicsStage } from '../src/triage/stages/heuristics.ts';
import type { MessageFacts } from '../src/triage/types.ts';
import { FakeMailbox, facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';

const BULK = {
  'list-id': '<offers.example.com>',
  'list-unsubscribe': '<https://example.com/u/abc>',
  'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
  'authentication-results': 'mx.example.org; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=bounce@mail7.mcsv.net; dmarc=pass header.from=example.com',
};
const SUBSTACK = { ...BULK, 'authentication-results': 'mx.example.org; dkim=pass header.i=@substack.com; dmarc=pass header.from=substack.com' };

const promo = (overrides: Partial<MessageFacts> = {}) => facts({ accountId: ACCOUNT, labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], headers: BULK, ...overrides });
const without = (name: keyof typeof BULK) => Object.fromEntries(Object.entries(BULK).filter(([key]) => key !== name));

const decide = (message: MessageFacts, hasWritten: boolean | null = false, labels = DEFAULT_LABELS) =>
  heuristicsStage({ labels, hasWritten: async () => hasWritten }).decide(message);

describe('heuristics stage', () => {
  it('labels a campaign Marketing when every sign agrees', async () => {
    expect(await decide(promo())).toEqual({
      disposition: 'archive',
      subscription: 'unsubscribe',
      labelId: 'marketing',
      gmailLabel: 'sift/marketing',
      stage: 'heuristics',
      reason: 'Marketing by its headers: list offers.example.com, one-click unsubscribe, sent through Mailchimp, filed under Promotions by Gmail',
    });
  });

  it('labels mail from a newsletter platform Newsletters, unless Gmail disagrees', async () => {
    expect(await decide(promo({ headers: SUBSTACK, labelIds: ['INBOX', 'CATEGORY_UPDATES'] }))).toMatchObject({ labelId: 'newsletter', stage: 'heuristics' });
    expect(await decide(promo({ headers: SUBSTACK, labelIds: ['INBOX'] }))).toMatchObject({ labelId: 'newsletter' });
    expect(await decide(promo({ headers: SUBSTACK }))).toBeNull();
    expect(await decide(promo({ headers: SUBSTACK, labelIds: ['INBOX', 'CATEGORY_PERSONAL'] }))).toBeNull();
  });

  it('never decides for a sender the owner has written to, or when that could not be checked', async () => {
    expect(await decide(promo(), true)).toBeNull();
    expect(await decide(promo(), null)).toBeNull();
  });

  it('abstains when any one sign is missing', async () => {
    expect(await decide(promo({ headers: without('list-id') }))).toBeNull();
    expect(await decide(promo({ headers: without('list-unsubscribe-post') }))).toBeNull();
    expect(await decide(promo({ headers: { ...BULK, 'authentication-results': 'mx.example.org; dkim=pass header.i=@example.com; dmarc=pass' } }))).toBeNull();
    expect(
      await decide(promo({ headers: { ...BULK, 'authentication-results': BULK['authentication-results'].replace('dmarc=pass', 'dmarc=fail') } })),
    ).toBeNull();
    expect(await decide(promo({ headers: { ...BULK, 'in-reply-to': '<a@example.org>' } }))).toBeNull();
  });

  it('abstains when it cannot tell which kind of bulk mail it is', async () => {
    expect(await decide(promo({ labelIds: ['INBOX', 'CATEGORY_UPDATES'] }))).toBeNull();
    expect(await decide(promo({ labelIds: ['INBOX'] }))).toBeNull();
    expect(await decide(promo({ headers: { ...BULK, 'auto-submitted': 'auto-generated' } }))).toBeNull();
  });

  it('abstains when the user has removed the label, and asks about the sender only for bulk mail', async () => {
    expect(
      await decide(
        promo(),
        false,
        DEFAULT_LABELS.filter((l) => l.id !== 'marketing'),
      ),
    ).toBeNull();
    let asked = 0;
    const stage = heuristicsStage({ labels: DEFAULT_LABELS, hasWritten: async () => (asked++, false) });
    await stage.decide(facts({ accountId: ACCOUNT }));
    expect(asked).toBe(0);
  });
});

describe('heuristics in the cascade', () => {
  const gmailMessage: RawMessage = {
    id: 'promo',
    threadId: 't-promo',
    labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
    internalDate: 1000,
    headers: [
      { name: 'From', value: 'Shop <offers@example.com>' },
      { name: 'To', value: ACCOUNT },
      { name: 'Subject', value: 'Autumn sale' },
      ...Object.entries(BULK).map(([name, value]) => ({ name, value })),
    ],
  };

  async function setup() {
    const db = await openUserDb();
    await addMailbox(db, ACCOUNT, '1', 0);
    const mailbox = new FakeMailbox();
    mailbox.labels.set(gmailMessage.id, [...gmailMessage.labelIds]);
    const api: GmailApi = {
      getProfile: async () => ({ emailAddress: ACCOUNT, historyId: '2' }),
      listHistory: async () => ({ additions: [{ id: gmailMessage.id, labelIds: gmailMessage.labelIds }], historyId: '2' }),
      searchInbox: async () => ({ ids: [] }),
      getMetadata: async () => gmailMessage,
      getBodyText: async () => null,
      getContent: async () => null,
      getThread: async () => null,
      getRaw: async () => null,
      getLabelIds: async (id) => mailbox.labels.get(id) ?? null,
      listLabels: async () => [],
    };
    const options = (heuristics: boolean): RunOptions => ({ act: false, heuristics, connect: () => ({ api, mailbox }), log: () => {} });
    const decisions = async () => await raw(db).all('SELECT stage, disposition, label_id FROM decisions');
    return { db, mailbox, options, decisions };
  }

  it('is off unless the setting turns it on', async () => {
    expect(DEFAULT_SETTINGS.heuristics).toBe(false);
    expect(parseSettings('heuristics = true').heuristics).toBe(true);
    expect(() => parseSettings('heuristics = "yes"')).toThrow('heuristics must be true or false');

    const { db, options, decisions } = await setup();
    await runOnce(db, options(false));
    // Nothing decided it, and with no model it waits in the queue rather than becoming a suggestion.
    expect(await decisions()).toEqual([]);
    expect(await listUndecided(db, ACCOUNT, 10)).toHaveLength(1);
  });

  it('decides before the model and is recorded under its own name', async () => {
    const { db, options, decisions } = await setup();
    let judged = 0;
    const model = async () => ({ judge: async () => (judged++, null), guidelines: '' });
    await runOnce(db, { ...options(true), model });
    expect(await decisions()).toMatchObject([{ stage: 'heuristics', disposition: 'archive', label_id: 'marketing' }]);
    expect(judged).toBe(0);
  });

  it('leaves mail from someone the owner has written to for the next tier', async () => {
    const { db, mailbox, options, decisions } = await setup();
    mailbox.sentTo.add('offers@example.com');
    await runOnce(db, options(true));
    expect(await decisions()).toEqual([]);
    expect(await listUndecided(db, ACCOUNT, 10)).toHaveLength(1);
  });

  it('leaves what no tier decided for a model, and the model decides it once there is one', async () => {
    const { db, options, decisions } = await setup();
    await runOnce(db, options(false));
    expect(await decisions()).toEqual([]);
    const model = async () => ({ judge: async () => ({ label: 'newsletter', reason: 'r', confidence: 0.9 }), guidelines: '' });
    await runOnce(db, { ...options(false), model });
    expect(await decisions()).toMatchObject([{ stage: 'agent', label_id: 'newsletter' }]);
  });
});
