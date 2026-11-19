import type { Sql } from '../store/sql.ts';
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
  mailBodies,
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
 * Forget messages nothing has happened to for `RETENTION_DAYS`, with their decisions, changes, model calls
 * and answers. A message is kept, however old, while anything still depends on its record:
 *
 * - it is waiting in the queue to be decided (mail the model ran out of tries on is not waiting, and goes
 *   like the rest);
 * - its example is kept: what the user answered, with the message it was about;
 * - a decision for it has not been carried out, or a change to it was never confirmed;
 * - sift unsubscribed through it, which is how it knows not to ask that sender again;
 * - any decision, change or model call for it is newer than the cutoff, so a recent change can still be
 *   undone. A suggestion still waiting on the user is spared this long, and no longer.
 *
 * Returns how many messages went. `PRUNE_PER_RUN` means there may be more.
 */
export async function pruneOld(db: Sql, now: number = Date.now()): Promise<number> {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  const decided = and(eq(decisions.accountId, messages.accountId), eq(decisions.messageId, messages.id));
  const going = await db
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
              .where(and(decided, or(gte(decisions.decidedAt, cutoff), and(eq(decisions.carryOut, true), isNull(decisions.outcome))))),
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
      ),
    )
    .orderBy(asc(messages.receivedAt))
    .limit(PRUNE_PER_RUN);
  if (going.length === 0) return 0;

  await db.transaction(async (tx) => {
    for (const m of going) {
      const of = (t: typeof suggestionBodies | typeof mailBodies | typeof actions | typeof decisions | typeof modelRuns) =>
        and(eq(t.accountId, m.accountId), eq(t.messageId, m.id));
      await tx.delete(suggestionBodies).where(of(suggestionBodies));
      await tx.delete(mailBodies).where(of(mailBodies));
      await tx.delete(actions).where(of(actions));
      await tx.delete(feedback).where(inArray(feedback.decisionId, tx.select({ id: decisions.id }).from(decisions).where(of(decisions))));
      await tx.delete(decisions).where(of(decisions));
      await tx.delete(modelRuns).where(of(modelRuns));
      await tx.delete(messages).where(and(eq(messages.accountId, m.accountId), eq(messages.id, m.id)));
    }
  });
  return going.length;
}
