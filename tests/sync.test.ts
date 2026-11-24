import { describe, expect, it } from 'vitest';
import { syncPage } from '../src/dashboard/queries/sync.ts';
import { scopeFor } from '../src/dashboard/scope.ts';
import { recordLabels, recordSync } from '../src/store/messages.ts';
import { setMail } from '../src/store/preferences.ts';
import { conversationChanges, eq, messages } from '../src/store/query.ts';
import { headOf, pruneGone } from '../src/store/changes.ts';
import { onePerson, raw } from './fixtures.ts';
import { ACCOUNT, facts } from './helpers.ts';

const DAY = 86_400_000;
const scope = scopeFor([ACCOUNT], true);

async function inboxOf(...threads: string[]) {
  const { db } = await onePerson(ACCOUNT);
  await setMail(db, true);
  await recordSync(
    db,
    ACCOUNT,
    threads.map((thread, i) => facts({ messageId: thread, threadId: thread, receivedAt: 100 + i, labelIds: ['INBOX'] })),
    '2',
  );
  return db;
}

describe('the numbers changes are given', () => {
  it('rise by one a change, each conversation keeping the number of its latest', async () => {
    const db = await inboxOf('a', 'b');
    const before = await headOf(db);
    await recordLabels(db, ACCOUNT, 'a', ['INBOX', 'STARRED']);
    await recordLabels(db, ACCOUNT, 'a', ['INBOX', 'STARRED']);
    expect((await headOf(db)).seq).toBe(before.seq + 1);
    const rows = await db.select({ threadId: conversationChanges.threadId, seq: conversationChanges.seq }).from(conversationChanges);
    expect(Object.fromEntries(rows.map((r) => [r.threadId, r.seq]))).toEqual({ a: before.seq + 1, b: expect.any(Number) });
  });

  it('are not given for a change no screen shows', async () => {
    const db = await inboxOf('a');
    const before = await headOf(db);
    await raw(db).run("UPDATE messages SET read_at = 5, synced_at = 9 WHERE id = 'a'");
    expect(await headOf(db)).toEqual(before);
  });
});

describe('what says a conversation went', () => {
  it('is dropped 30 days after it went, and a cursor from before then gets the whole copy', async () => {
    const db = await inboxOf('a', 'b');
    const old = (await syncPage(db, scope, undefined)).cursor;
    expect(await pruneGone(db, Date.now())).toBe(0);

    // Forgotten, as retention forgets a message a year on.
    await db.delete(messages).where(eq(messages.id, 'a'));
    const gone = await syncPage(db, scope, old);
    expect(gone).toMatchObject({ reset: false, conversations: [{ threadId: 'a', conversation: null }] });

    expect(await pruneGone(db, Date.now() + 31 * DAY)).toBe(1);
    expect(await syncPage(db, scope, old)).toMatchObject({ reset: true, conversations: [{ threadId: 'b' }] });
    expect(await syncPage(db, scope, gone.cursor)).toMatchObject({ reset: false, conversations: [] });
  });
});
