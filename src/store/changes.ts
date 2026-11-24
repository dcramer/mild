import { and, conversationChanges, eq, inArray, lt, messages, notExists, sql, syncHeads } from './query.ts';
import type { Sql } from './sql.ts';
import { DAY_MS } from '../time.ts';

/** Where a person's copy stands (docs/sync.md): the latest change's number, and the oldest a cursor may be from. */
export async function headOf(db: Sql): Promise<{ seq: number; purgedThrough: number }> {
  const [row] = await db.select({ seq: syncHeads.seq, purgedThrough: syncHeads.purgedThrough }).from(syncHeads);
  return row ?? { seq: 0, purgedThrough: 0 };
}

/** How long a conversation gone from the record is still said to be gone, to a page that last asked before it went. */
const GONE_KEEP_DAYS = 30;

/**
 * Drop what says a conversation went, once it went `GONE_KEEP_DAYS` ago, and move the person's `purgedThrough` past it, so
 * a cursor from before then gets the whole copy again rather than an answer missing that it went. Returns how many went.
 */
export async function pruneGone(db: Sql, now: number): Promise<number> {
  const recorded = db
    .select({ one: sql`1` })
    .from(messages)
    .where(and(eq(messages.accountId, conversationChanges.accountId), eq(messages.threadId, conversationChanges.threadId)));
  const gone = await db
    .select({ accountId: conversationChanges.accountId, threadId: conversationChanges.threadId, seq: conversationChanges.seq })
    .from(conversationChanges)
    .where(and(lt(conversationChanges.changedAt, now - GONE_KEEP_DAYS * DAY_MS), notExists(recorded)));
  if (gone.length === 0) return 0;
  const through = Math.max(...gone.map((g) => g.seq));
  await db.transaction(async (tx) => {
    for (const accountId of new Set(gone.map((g) => g.accountId)))
      await tx.delete(conversationChanges).where(
        and(
          eq(conversationChanges.accountId, accountId),
          inArray(
            conversationChanges.threadId,
            gone.filter((g) => g.accountId === accountId).map((g) => g.threadId),
          ),
          // One recorded again since is not gone.
          notExists(recorded),
        ),
      );
    await tx.update(syncHeads).set({ purgedThrough: sql`greatest(${syncHeads.purgedThrough}, ${through})` });
  });
  return gone.length;
}
