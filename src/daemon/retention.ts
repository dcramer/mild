import type { Sql } from '../store/sql.ts';
import { pendingSuggestions } from '../learn/feedback.ts';

/** Deleting is synchronous and the dashboard is served from the same process, so a backlog goes in pieces. */
export const PRUNE_PER_RUN = 5000;

/**
 * Forget messages nothing has happened to for `days`, with their decisions and changes. A message is
 * kept, however old, while anything still depends on its record:
 *
 * - it is a suggestion waiting on the user, or has not been decided at all;
 * - the user answered for it (`feedback`, `examples`): that is what sift learned from;
 * - a decision for it has not been carried out, or a change to it was never confirmed;
 * - sift unsubscribed through it, which is how it knows not to ask that sender again;
 * - any decision or change for it is newer than the cutoff, so a recent change can still be undone.
 *
 * Returns how many messages went. `PRUNE_PER_RUN` means there may be more.
 */
export async function pruneOld(db: Sql, days: number, now: number = Date.now()): Promise<number> {
  const cutoff = now - days * 86_400_000;
  const old = await db.all<{ account_id: string; id: string }>(
    `SELECT m.account_id, m.id FROM messages m
       WHERE m.received_at < :cutoff AND coalesce(m.synced_at, 0) < :cutoff
         AND EXISTS (SELECT 1 FROM decisions d WHERE d.account_id = m.account_id AND d.message_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.account_id = m.account_id AND d.message_id = m.id AND (d.decided_at >= :cutoff OR d.outcome IS NULL))
         AND NOT EXISTS (
           SELECT 1 FROM actions a WHERE a.account_id = m.account_id AND a.message_id = m.id
             AND (a.created_at >= :cutoff OR a.status IN ('pending', 'unknown') OR (a.type = 'unsubscribe' AND a.status = 'done')))
         AND NOT EXISTS (SELECT 1 FROM examples e WHERE e.account_id = m.account_id AND e.message_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.account_id = m.account_id AND f.message_id = m.id)
       ORDER BY m.received_at`,
    { cutoff },
  );
  if (old.length === 0) return 0;

  const key = (accountId: string, messageId: string) => `${accountId}\n${messageId}`;
  const waiting = new Set((await pendingSuggestions(db, { limit: Number.MAX_SAFE_INTEGER })).map((s) => key(s.accountId, s.messageId)));
  const going = old.filter((m) => !waiting.has(key(m.account_id, m.id))).slice(0, PRUNE_PER_RUN);

  const statements = [
    ...['suggestion_bodies', 'actions', 'decisions'].map((table) => `DELETE FROM ${table} WHERE account_id = ? AND message_id = ?`),
    'DELETE FROM messages WHERE account_id = ? AND id = ?',
  ];
  await db.transaction(async (tx) => {
    for (const m of going) for (const statement of statements) await tx.run(statement, m.account_id, m.id);
  });
  return going.length;
}
