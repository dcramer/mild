import type { Sql } from '../store/sql.ts';
import { pendingSuggestions } from '../learn/feedback.ts';
import { outOfTries } from '../store/runs.ts';
import {
  actions,
  and,
  asc,
  decisions,
  eq,
  examples,
  exists,
  feedback,
  gte,
  inArray,
  isNull,
  lt,
  messages,
  modelRuns,
  not,
  or,
  sql,
  suggestionBodies,
} from '../store/query.ts';

/**
 * A year: long enough to look back over and undo a change from, and well past sync's 7-day recovery search,
 * which could otherwise bring back a message already forgotten and decide it twice.
 */
export const RETENTION_DAYS = 365;

/** Deleting is synchronous and the dashboard is served from the same process, so a backlog goes in pieces. */
export const PRUNE_PER_RUN = 5000;

/**
 * Forget messages nothing has happened to for `RETENTION_DAYS`, with their decisions and changes. A message is
 * kept, however old, while anything still depends on its record:
 *
 * - it is a suggestion waiting on the user, or is waiting in the queue to be decided (mail the model ran out
 *   of tries on is not waiting, and goes like the rest);
 * - the user answered for it (`feedback`, `examples`): that is what sift learned from;
 * - a decision for it has not been carried out, or a change to it was never confirmed;
 * - sift unsubscribed through it, which is how it knows not to ask that sender again;
 * - any decision, change or model call for it is newer than the cutoff, so a recent change can still be undone.
 *
 * Returns how many messages went. `PRUNE_PER_RUN` means there may be more.
 */
export async function pruneOld(db: Sql, now: number = Date.now()): Promise<number> {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  const decided = and(eq(decisions.accountId, messages.accountId), eq(decisions.messageId, messages.id));
  const old = await db
    .select({ accountId: messages.accountId, id: messages.id })
    .from(messages)
    .where(
      and(
        lt(messages.receivedAt, cutoff),
        lt(messages.syncedAt, cutoff),
        or(
          exists(
            db
              .select({ one: sql`1` })
              .from(decisions)
              .where(decided),
          ),
          outOfTries(db, messages.accountId, messages.id),
        ),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(modelRuns)
              .where(and(eq(modelRuns.accountId, messages.accountId), eq(modelRuns.messageId, messages.id), gte(modelRuns.startedAt, cutoff))),
          ),
        ),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(decisions)
              .where(and(decided, or(gte(decisions.decidedAt, cutoff), isNull(decisions.outcome)))),
          ),
        ),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(actions)
              .where(
                and(
                  eq(actions.accountId, messages.accountId),
                  eq(actions.messageId, messages.id),
                  or(
                    gte(actions.createdAt, cutoff),
                    inArray(actions.status, ['pending', 'unknown']),
                    and(eq(actions.type, 'unsubscribe'), eq(actions.status, 'done')),
                  ),
                ),
              ),
          ),
        ),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(examples)
              .where(and(eq(examples.accountId, messages.accountId), eq(examples.messageId, messages.id))),
          ),
        ),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(feedback)
              .where(and(eq(feedback.accountId, messages.accountId), eq(feedback.messageId, messages.id))),
          ),
        ),
      ),
    )
    .orderBy(asc(messages.receivedAt));
  if (old.length === 0) return 0;

  const key = (accountId: string, messageId: string) => `${accountId}\n${messageId}`;
  const waiting = new Set((await pendingSuggestions(db, { limit: Number.MAX_SAFE_INTEGER })).map((s) => key(s.accountId, s.messageId)));
  const going = old.filter((m) => !waiting.has(key(m.accountId, m.id))).slice(0, PRUNE_PER_RUN);

  await db.transaction(async (tx) => {
    for (const m of going) {
      for (const table of [suggestionBodies, actions, decisions, modelRuns])
        await tx.delete(table).where(and(eq(table.accountId, m.accountId), eq(table.messageId, m.id)));
      await tx.delete(messages).where(and(eq(messages.accountId, m.accountId), eq(messages.id, m.id)));
    }
  });
  return going.length;
}
