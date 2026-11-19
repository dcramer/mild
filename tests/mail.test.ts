import { beforeEach, describe, expect, it } from 'vitest';
import type { GmailApi, HistoryLabelChange, RawMessage } from '../src/gmail/api.ts';
import type { Sql } from '../src/store/sql.ts';
import { syncAccount } from '../src/work/sync.ts';
import { firstAccount, openUserDb, raw } from './fixtures.ts';
import { ACCOUNT, rawMessage } from './helpers.ts';

let db: Sql;
let inbox: RawMessage[];
let history: HistoryLabelChange[];
let cursor: number;

/** A Gmail whose history hands over `inbox` as new mail and `history` as label changes, once each. */
const gmail = (): GmailApi => ({
  getProfile: async () => ({ emailAddress: ACCOUNT, historyId: String(cursor) }),
  listHistory: async () => ({
    additions: inbox.splice(0).map((m) => ({ id: m.id, labelIds: m.labelIds })),
    labelChanges: history.splice(0),
    historyId: String(++cursor),
  }),
  searchInbox: async () => ({ ids: [] }),
  inboxSize: async () => 0,
  getMetadata: async (id) => known.find((m) => m.id === id) ?? null,
  getLabelIds: async () => null,
  listLabels: async () => [],
  getThread: async () => null,
  listSendAs: async () => [ACCOUNT],
  getContent: async () => null,
});
let known: RawMessage[];

const labelsOf = async (id: string) => (await raw(db).get<{ label_ids: string[] }>('SELECT label_ids FROM messages WHERE id = ?', id))?.label_ids;
const sync = async () => await syncAccount(db, gmail(), await firstAccount(db), () => 5000);

beforeEach(async () => {
  db = await openUserDb(ACCOUNT);
  cursor = 1;
  known = [rawMessage('a'), rawMessage('b')];
  inbox = [...known];
  history = [];
});

describe('a recorded message’s labels', () => {
  it('follow Gmail’s history, so what is in the inbox and what is unread can be read from the record', async () => {
    await sync();
    expect(await labelsOf('a')).toEqual(['INBOX', 'UNREAD']);
    history = [
      { messageId: 'a', added: [], removed: ['UNREAD'] },
      { messageId: 'b', added: [], removed: ['INBOX'] },
      { messageId: 'b', added: ['STARRED'], removed: [] },
      { messageId: 'unrecorded', added: ['INBOX'], removed: [] },
    ];
    await sync();
    expect(await labelsOf('a')).toEqual(['INBOX']);
    expect((await labelsOf('b'))?.toSorted()).toEqual(['STARRED', 'UNREAD']);
  });

  it('end where the last change to each label left them, however often the same history is read', async () => {
    await sync();
    const changes = [
      { messageId: 'a', added: [], removed: ['INBOX'] },
      { messageId: 'a', added: ['INBOX'], removed: [] },
      { messageId: 'a', added: [], removed: ['UNREAD'] },
    ];
    history = [...changes];
    await sync();
    history = [...changes];
    await sync();
    expect(await labelsOf('a')).toEqual(['INBOX']);
  });
});
