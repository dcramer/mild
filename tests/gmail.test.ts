import { describe, expect, it } from 'vitest';
import { syncAccount } from '../src/daemon/sync.ts';
import { type GmailApi, HistoryExpiredError, type HistoryPage, type RawMessage } from '../src/gmail/api.ts';
import { pullChanges, toFacts } from '../src/gmail/sync.ts';
import { addMailbox, listAccounts } from '../src/store/accounts.ts';
import { openUserDb, raw } from './fixtures.ts';
import { parseAddressList } from '../src/triage/features.ts';

function gmailMessage(id: string, overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id,
    threadId: `t-${id}`,
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: 1000,
    headers: [
      { name: 'From', value: 'News <news@example.com>' },
      { name: 'To', value: 'me@example.org' },
      { name: 'Subject', value: `Subject ${id}` },
    ],
    ...overrides,
  };
}

interface Fake {
  historyId?: string;
  pages?: Record<string, HistoryPage>;
  expired?: boolean;
  /** History pages, by page token, that fail as an expired cursor would. */
  expiredAt?: string[];
  search?: string[];
  searchPages?: Record<string, { ids: string[]; nextPageToken?: string }>;
  messages?: Record<string, RawMessage>;
}

function fakeApi(fake: Fake): GmailApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getProfile() {
      calls.push('profile');
      return { emailAddress: 'me@example.org', historyId: fake.historyId ?? '900' };
    },
    async listHistory(start, pageToken) {
      calls.push(`history:${start}:${pageToken ?? ''}`);
      if (fake.expired || fake.expiredAt?.includes(pageToken ?? '')) throw new HistoryExpiredError();
      const page = fake.pages?.[pageToken ?? ''];
      if (!page) throw new Error('unexpected page');
      return page;
    },
    async searchInbox(query, pageToken) {
      calls.push(`search:${query}${pageToken ? `:${pageToken}` : ''}`);
      return fake.searchPages?.[pageToken ?? ''] ?? { ids: fake.search ?? [] };
    },
    async getMetadata(id) {
      return fake.messages?.[id] ?? null;
    },
    async getLabelIds(id) {
      return fake.messages?.[id]?.labelIds ?? null;
    },
    async listLabels() {
      return [];
    },
    async getBodyText() {
      return null;
    },
    async getContent() {
      return null;
    },
    async getThread() {
      return null;
    },
    async getRaw() {
      return null;
    },
  };
}

describe('pullChanges', () => {
  it('only records the current position on first run', async () => {
    const api = fakeApi({ historyId: '500' });
    expect(await pullChanges(api, null)).toEqual({ messageIds: [], labelChanges: [], historyId: '500', mode: 'start' });
    expect(api.calls).toEqual(['profile']);
  });

  it('pages through history, keeps inbox arrivals and deduplicates', async () => {
    const api = fakeApi({
      pages: {
        '': {
          additions: [
            { id: 'a', labelIds: ['INBOX'] },
            { id: 'sent', labelIds: ['SENT'] },
          ],
          historyId: '510',
          nextPageToken: 'p2',
        },
        p2: {
          additions: [
            { id: 'a', labelIds: ['INBOX'] },
            { id: 'b', labelIds: ['INBOX', 'UNREAD'] },
          ],
          historyId: '520',
        },
      },
    });
    expect(await pullChanges(api, '500')).toEqual({ messageIds: ['a', 'b'], labelChanges: [], historyId: '520', mode: 'incremental' });
    expect(api.calls).toEqual(['history:500:', 'history:500:p2']);
  });

  it('falls back to a bounded search when the cursor has expired, reading the new cursor first', async () => {
    const api = fakeApi({ expired: true, historyId: '900', search: ['new', 'old'] });
    expect(await pullChanges(api, '1')).toEqual({ messageIds: ['old', 'new'], labelChanges: [], historyId: '900', mode: 'recovery' });
    expect(api.calls).toEqual(['history:1:', 'profile', 'search:newer_than:7d']);
  });

  it('takes the cursor from the last of many pages', async () => {
    const pages: Record<string, HistoryPage> = {};
    for (let n = 0; n < 5; n++) {
      pages[n === 0 ? '' : `p${n}`] = {
        additions: Array.from({ length: 100 }, (_, i) => ({ id: `m${n * 100 + i}`, labelIds: ['INBOX'] })),
        historyId: String(600 + n),
        ...(n < 4 ? { nextPageToken: `p${n + 1}` } : {}),
      };
    }
    const api = fakeApi({ pages });
    const pull = await pullChanges(api, '500');
    expect(pull.messageIds).toHaveLength(500);
    expect(pull.messageIds[0]).toBe('m0');
    expect(pull.messageIds.at(-1)).toBe('m499');
    expect(pull.historyId).toBe('604');
    expect(api.calls).toEqual(['history:500:', 'history:500:p1', 'history:500:p2', 'history:500:p3', 'history:500:p4']);
  });

  it('recovers when the cursor expires part-way through the pages, and pages through the search', async () => {
    const api = fakeApi({
      pages: { '': { additions: [{ id: 'from-history', labelIds: ['INBOX'] }], historyId: '510', nextPageToken: 'p2' } },
      expiredAt: ['p2'],
      historyId: '900',
      searchPages: { '': { ids: ['d', 'c'], nextPageToken: 's2' }, s2: { ids: ['c', 'b', 'a'] } },
    });
    // What the first history page said is dropped: the search covers it, and the cursor is the profile's.
    expect(await pullChanges(api, '500')).toEqual({ messageIds: ['a', 'b', 'c', 'd'], labelChanges: [], historyId: '900', mode: 'recovery' });
    expect(api.calls).toEqual(['history:500:', 'history:500:p2', 'profile', 'search:newer_than:7d', 'search:newer_than:7d:s2']);
  });

  it('propagates other errors without moving the cursor', async () => {
    const api = fakeApi({});
    await expect(pullChanges(api, '1')).rejects.toThrow('unexpected page');
  });
});

describe('toFacts', () => {
  it('lowercases header names and keeps the first of repeated headers', () => {
    const facts = toFacts(
      'acct',
      gmailMessage('m', {
        headers: [
          { name: 'FROM', value: '"Ada, L" <Ada@Example.com>' },
          { name: 'To', value: '"Doe, J" <j@example.org>, k@example.org' },
          { name: 'Authentication-Results', value: 'mx.example.org; dkim=pass' },
          { name: 'Authentication-Results', value: 'forged.example; dkim=pass' },
          { name: 'List-ID', value: '<dev.lists.example.com>' },
        ],
      }),
    );
    expect(facts).toMatchObject({
      accountId: 'acct',
      messageId: 'm',
      from: { address: 'ada@example.com', domain: 'example.com', name: 'Ada, L' },
      subject: '',
      receivedAt: 1000,
    });
    expect(facts?.to.map((a) => a.address)).toEqual(['j@example.org', 'k@example.org']);
    expect(facts?.headers['authentication-results']).toBe('mx.example.org; dkim=pass');
    expect(facts?.headers['list-id']).toBe('<dev.lists.example.com>');
  });

  it('returns null without a usable sender', () => {
    expect(toFacts('acct', gmailMessage('m', { headers: [{ name: 'Subject', value: 'x' }] }))).toBeNull();
  });
});

describe('parseAddressList', () => {
  it('handles empty input and drops junk', () => {
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList('undisclosed-recipients:;, a@example.com').map((a) => a.address)).toEqual(['a@example.com']);
  });
});

const page = (ids: string[], historyId: string): Record<string, HistoryPage> => ({
  '': { additions: ids.map((id) => ({ id, labelIds: ['INBOX'] })), historyId },
});

describe('syncAccount', () => {
  it('records new inbox mail and advances the cursor', async () => {
    const db = await openUserDb();
    await addMailbox(db, 'me@example.org', '500', 0);
    const api = fakeApi({
      pages: page(['a', 'archived', 'gone', 'nosender'], '520'),
      messages: { a: gmailMessage('a'), archived: gmailMessage('archived', { labelIds: ['UNREAD'] }), nosender: gmailMessage('nosender', { headers: [] }) },
    });

    const report = await syncAccount(db, api, (await listAccounts(db))[0]!);
    expect(report.added.map((m) => m.messageId)).toEqual(['a']);
    expect(report.skipped).toBe(3);
    expect((await listAccounts(db))[0]?.historyId).toBe('520');
    expect(await raw(db).all('SELECT id, from_domain FROM messages')).toEqual([{ id: 'a', from_domain: 'example.com' }]);
  });

  it('does not report a redelivered message as new', async () => {
    const db = await openUserDb();
    await addMailbox(db, 'me@example.org', '500', 0);
    const fake = { pages: page(['a'], '520'), messages: { a: gmailMessage('a') } };
    await syncAccount(db, fakeApi(fake), (await listAccounts(db))[0]!);
    const again = await syncAccount(db, fakeApi(fake), (await listAccounts(db))[0]!);
    expect(again.added).toEqual([]);
    expect(await raw(db).get('SELECT count(*) AS n FROM messages')).toEqual({ n: 1 });
  });

  it('records every page of a busy day in one pass and leaves the cursor alone if a later page fails', async () => {
    const db = await openUserDb();
    await addMailbox(db, 'me@example.org', '500', 0);
    const pages: Record<string, HistoryPage> = {
      '': { additions: [{ id: 'a', labelIds: ['INBOX'] }], historyId: '510', nextPageToken: 'p2' },
      p2: { additions: [{ id: 'b', labelIds: ['INBOX'] }], historyId: '520', nextPageToken: 'p3' },
    };
    const messages = { a: gmailMessage('a'), b: gmailMessage('b'), c: gmailMessage('c') };
    await expect(syncAccount(db, fakeApi({ pages, messages }), (await listAccounts(db))[0]!)).rejects.toThrow('unexpected page');
    expect((await listAccounts(db))[0]?.historyId).toBe('500');
    expect(await raw(db).get('SELECT count(*) AS n FROM messages')).toEqual({ n: 0 });

    pages['p3'] = { additions: [{ id: 'c', labelIds: ['INBOX'] }], historyId: '530' };
    const report = await syncAccount(db, fakeApi({ pages, messages }), (await listAccounts(db))[0]!);
    expect(report.added.map((m) => m.messageId)).toEqual(['a', 'b', 'c']);
    expect((await listAccounts(db))[0]?.historyId).toBe('530');
  });

  it('after an expired cursor, records what the search finds, skips what it already had, and carries on from the new cursor', async () => {
    const db = await openUserDb();
    await addMailbox(db, 'me@example.org', '500', 0);
    const messages = { a: gmailMessage('a'), b: gmailMessage('b'), c: gmailMessage('c') };
    await syncAccount(db, fakeApi({ pages: page(['a'], '520'), messages }), (await listAccounts(db))[0]!);

    const recovering = fakeApi({ expired: true, historyId: '900', search: ['b', 'a'], messages });
    const recovered = await syncAccount(db, recovering, (await listAccounts(db))[0]!);
    expect(recovered.mode).toBe('recovery');
    expect(recovered.added.map((m) => m.messageId)).toEqual(['b']);
    expect(recovering.calls).toEqual(['history:520:', 'profile', 'search:newer_than:7d']);
    expect((await listAccounts(db))[0]?.historyId).toBe('900');

    const next = fakeApi({ pages: page(['c'], '910'), messages });
    const after = await syncAccount(db, next, (await listAccounts(db))[0]!);
    expect(after.mode).toBe('incremental');
    expect(after.added.map((m) => m.messageId)).toEqual(['c']);
    expect(next.calls).toEqual(['history:900:']);
  });

  it('leaves the cursor alone when the search after an expired cursor fails', async () => {
    const db = await openUserDb();
    await addMailbox(db, 'me@example.org', '500', 0);
    const api = fakeApi({ expired: true, historyId: '900' });
    api.searchInbox = async () => {
      throw new Error('network');
    };
    await expect(syncAccount(db, api, (await listAccounts(db))[0]!)).rejects.toThrow('network');
    expect((await listAccounts(db))[0]?.historyId).toBe('500');
  });

  it('records that the user opened a message, once, whichever page or pass says so', async () => {
    const db = await openUserDb();
    await addMailbox(db, 'me@example.org', '500', 0);
    const messages = { a: gmailMessage('a'), b: gmailMessage('b', { labelIds: ['INBOX'] }) };
    await syncAccount(db, fakeApi({ pages: page(['a'], '510'), messages }), (await listAccounts(db))[0]!, () => 1000);

    // `a` is opened, `b` arrives and is opened before sift has seen it, and a message sift never recorded is opened.
    const pages: Record<string, HistoryPage> = {
      '': { additions: [], labelChanges: [{ messageId: 'a', added: [], removed: ['UNREAD'] }], historyId: '520', nextPageToken: 'p2' },
      p2: {
        additions: [{ id: 'b', labelIds: ['INBOX', 'UNREAD'] }],
        labelChanges: [
          { messageId: 'b', added: [], removed: ['UNREAD'] },
          { messageId: 'elsewhere', added: [], removed: ['UNREAD'] },
          { messageId: 'a', added: ['STARRED'], removed: [] },
        ],
        historyId: '530',
      },
    };
    const reads = async () => await raw(db).all('SELECT id, read_at FROM messages ORDER BY id');
    await syncAccount(db, fakeApi({ pages, messages }), (await listAccounts(db))[0]!, () => 2000);
    expect(await reads()).toEqual([
      { id: 'a', read_at: 2000 },
      { id: 'b', read_at: 2000 },
    ]);

    // The same history again, as after a crash before the cursor moved, and the user marking it unread and reading it again.
    await syncAccount(db, fakeApi({ pages, messages }), (await listAccounts(db))[0]!, () => 3000);
    expect(await reads()).toEqual([
      { id: 'a', read_at: 2000 },
      { id: 'b', read_at: 2000 },
    ]);
  });

  it('learns nothing about reading from a search after an expired cursor', async () => {
    const db = await openUserDb();
    await addMailbox(db, 'me@example.org', '500', 0);
    const api = fakeApi({ expired: true, search: ['a'], messages: { a: gmailMessage('a', { labelIds: ['INBOX'] }) } });
    await syncAccount(db, api, (await listAccounts(db))[0]!);
    expect(await raw(db).get('SELECT read_at FROM messages')).toEqual({ read_at: null });
  });

  it('leaves the cursor alone when a fetch fails', async () => {
    const db = await openUserDb();
    await addMailbox(db, 'me@example.org', '500', 0);
    const api = fakeApi({ pages: page(['a'], '520') });
    api.getMetadata = async () => {
      throw new Error('network');
    };
    await expect(syncAccount(db, api, (await listAccounts(db))[0]!)).rejects.toThrow('network');
    expect((await listAccounts(db))[0]?.historyId).toBe('500');
  });
});
