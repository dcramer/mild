import { type AnyColumn, and, count, decisions, eq, inArray, isNull, messages, modelRuns, notExists, sql } from './query.ts';
import type { Sql } from './sql.ts';
import type { Usage } from '../triage/stages/model.ts';

/** A message whose model call has failed this many times leaves the queue until the user puts it back. */
export const MAX_ATTEMPTS = 3;
/** Enough for what a provider says went wrong. */
const MAX_ERROR = 500;

/**
 * A call that counts against its message: one no decision came of (it failed, was cut short, or its
 * verdict was never recorded), unless the user put the message back or it was part of an outage.
 */
const counted = (db: Sql) =>
  and(
    isNull(modelRuns.retriedAt),
    notExists(
      db
        .select({ one: sql`1` })
        .from(decisions)
        .where(and(eq(decisions.userId, modelRuns.userId), eq(decisions.runId, modelRuns.id))),
    ),
  );

const forMessage = (accountId: string | AnyColumn, messageId: string | AnyColumn) =>
  and(eq(modelRuns.accountId, accountId), eq(modelRuns.messageId, messageId));

/** For a query over messages: true where the model has failed on the message too often to try again. */
export const outOfTries = (db: Sql, accountId: AnyColumn, messageId: AnyColumn) =>
  sql`(${db
    .select({ n: count() })
    .from(modelRuns)
    .where(and(forMessage(accountId, messageId), counted(db)))}) >= ${MAX_ATTEMPTS}`;

/** Stamped before the call, so a pass that stops part-way leaves a run that counts as failed. */
export async function startRun(db: Sql, run: { accountId: string; messageId: string; model: string; now: number }): Promise<number> {
  const [row] = await db
    .insert(modelRuns)
    .values({ accountId: run.accountId, messageId: run.messageId, model: run.model, startedAt: run.now })
    .returning({ id: modelRuns.id });
  return row!.id;
}

export async function finishRun(db: Sql, id: number, result: { error?: string; usage?: Usage; now: number }): Promise<void> {
  await db
    .update(modelRuns)
    .set({
      error: result.error?.slice(0, MAX_ERROR) ?? null,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      costUsd: result.usage?.costUsd ?? 0,
      finishedAt: result.now,
    })
    .where(eq(modelRuns.id, id));
}

/** Put a message back in the queue: its failures stop counting. False when none counted. */
export async function putBackInQueue(db: Sql, accountId: string, messageId: string, now: number): Promise<boolean> {
  const rows = await db
    .update(modelRuns)
    .set({ retriedAt: now })
    .where(and(forMessage(accountId, messageId), counted(db)))
    .returning({ id: modelRuns.id });
  return rows.length > 0;
}

/** Put every undecided message the model has run out of tries on back in the queue. Returns how many. */
export async function putAllBackInQueue(db: Sql, accounts: readonly string[], now: number): Promise<number> {
  return await db.transaction(async (tx) => {
    const stuck = await tx
      .select({ accountId: messages.accountId, id: messages.id })
      .from(messages)
      .where(
        and(
          inArray(messages.accountId, accounts),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(decisions)
              .where(and(eq(decisions.accountId, messages.accountId), eq(decisions.messageId, messages.id))),
          ),
          outOfTries(tx, messages.accountId, messages.id),
        ),
      );
    for (const m of stuck) await putBackInQueue(tx, m.accountId, m.id, now);
    return stuck.length;
  });
}

/** Failures that say nothing about their messages (the provider was down): they stop counting, as if put back. */
export async function excuseRuns(db: Sql, ids: readonly number[], now: number): Promise<void> {
  if (ids.length > 0) await db.update(modelRuns).set({ retriedAt: now }).where(inArray(modelRuns.id, ids));
}
