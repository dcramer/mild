import { describe, expect, it } from 'vitest';
import { syncAccount } from '../src/daemon/sync.ts';
import { type GmailApi, HistoryExpiredError, type HistoryPage, type RawMessage } from '../src/gmail/api.ts';
import { parseCallback } from '../src/gmail/auth.ts';
import { pullChanges, toFacts } from '../src/gmail/sync.ts';
import { connectAccount, listAccounts } from '../src/store/accounts.ts';
import { openDb } from '../src/store/db.ts';
import { parseAddressList } from '../src/triage/features.ts';

function raw(id: string, overrides: Partial<RawMessage> = {}): RawMessage {
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
  search?: string[];
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
      if (fake.expired) throw new HistoryExpiredError();
      const page = fake.pages?.[pageToken ?? ''];
      if (!page) throw new Error('unexpected page');
      return page;
    },
    async searchInbox(query) {
      calls.push(`search:${query}`);
      return { ids: fake.search ?? [] };
    },
    async getMetadata(id) {
      return fake.messages?.[id] ?? null;
    },
    async getBodyText() {
      return null;
    },
  };
}

describe('pullChanges', () => {
  it('only records the current position on first run', async () => {
    const api = fakeApi({ historyId: '500' });
    expect(await pullChanges(api, null)).toEqual({ messageIds: [], historyId: '500', mode: 'start' });
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
    expect(await pullChanges(api, '500')).toEqual({ messageIds: ['a', 'b'], historyId: '520', mode: 'incremental' });
    expect(api.calls).toEqual(['history:500:', 'history:500:p2']);
  });

  it('falls back to a bounded search when the cursor has expired, reading the new cursor first', async () => {
    const api = fakeApi({ expired: true, historyId: '900', search: ['new', 'old'] });
    expect(await pullChanges(api, '1', { recoveryDays: 3 })).toEqual({ messageIds: ['old', 'new'], historyId: '900', mode: 'recovery' });
    expect(api.calls).toEqual(['history:1:', 'profile', 'search:newer_than:3d']);
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
      raw('m', {
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
    expect(toFacts('acct', raw('m', { headers: [{ name: 'Subject', value: 'x' }] }))).toBeNull();
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
    const db = openDb(':memory:');
    connectAccount(db, 'me@example.org', '500', 0);
    const api = fakeApi({
      pages: page(['a', 'archived', 'gone', 'nosender'], '520'),
      messages: { a: raw('a'), archived: raw('archived', { labelIds: ['UNREAD'] }), nosender: raw('nosender', { headers: [] }) },
    });

    const report = await syncAccount(db, api, listAccounts(db)[0]!);
    expect(report.added.map((m) => m.messageId)).toEqual(['a']);
    expect(report.skipped).toBe(3);
    expect(listAccounts(db)[0]?.historyId).toBe('520');
    expect(db.prepare('SELECT id, from_domain FROM messages').all()).toEqual([{ id: 'a', from_domain: 'example.com' }]);
  });

  it('does not report a redelivered message as new', async () => {
    const db = openDb(':memory:');
    connectAccount(db, 'me@example.org', '500', 0);
    const fake = { pages: page(['a'], '520'), messages: { a: raw('a') } };
    await syncAccount(db, fakeApi(fake), listAccounts(db)[0]!);
    const again = await syncAccount(db, fakeApi(fake), listAccounts(db)[0]!);
    expect(again.added).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 1 });
  });

  it('leaves the cursor alone when a fetch fails', async () => {
    const db = openDb(':memory:');
    connectAccount(db, 'me@example.org', '500', 0);
    const api = fakeApi({ pages: page(['a'], '520') });
    api.getMetadata = async () => {
      throw new Error('network');
    };
    await expect(syncAccount(db, api, listAccounts(db)[0]!)).rejects.toThrow('network');
    expect(listAccounts(db)[0]?.historyId).toBe('500');
  });
});

describe('parseCallback', () => {
  it('returns the code when state matches', () => {
    expect(parseCallback('http://127.0.0.1:8765/?state=s1&code=abc&scope=x', 's1')).toBe('abc');
    expect(parseCallback('/?code=abc&state=s1', 's1')).toBe('abc');
  });

  it('rejects a wrong state, a denial and a missing code', () => {
    expect(() => parseCallback('/?code=abc&state=other', 's1')).toThrow(/state mismatch/);
    expect(() => parseCallback('/?error=access_denied&state=s1', 's1')).toThrow(/access_denied/);
    expect(() => parseCallback('/?state=s1', 's1')).toThrow(/no authorization code/);
  });
});
