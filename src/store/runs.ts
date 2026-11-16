import { type AnyColumn, type RUN_OUTCOMES, and, count, eq, isNull, modelRuns, or, sql } from './query.ts';
import type { Sql } from './sql.ts';
import type { Usage } from '../triage/stages/model.ts';

/** A message whose model call has failed this many times leaves the queue until the user puts it back. */
export const MAX_ATTEMPTS = 3;
/** Enough for what a provider says went wrong. */
const MAX_ERROR = 500;

type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** A failure that still counts against its message: one cut short counts, one the user put back does not. */
export const counted = and(or(isNull(modelRuns.outcome), eq(modelRuns.outcome, 'failed')), isNull(modelRuns.retriedAt));

const forMessage = (accountId: string | AnyColumn, messageId: string | AnyColumn) =>
  and(eq(modelRuns.accountId, accountId), eq(modelRuns.messageId, messageId));

/** For a query over messages: true where the model has failed on the message too often to try again. */
export const outOfTries = (db: Sql, accountId: AnyColumn, messageId: AnyColumn) =>
  sql`(${db
    .select({ n: count() })
    .from(modelRuns)
    .where(and(forMessage(accountId, messageId), counted))}) >= ${MAX_ATTEMPTS}`;

/** Stamped before the call, so a pass that stops part-way leaves a run that counts as failed. */
export async function startRun(db: Sql, run: { accountId: string; messageId: string; model: string; now: number }): Promise<number> {
  const [row] = await db
    .insert(modelRuns)
    .values({ accountId: run.accountId, messageId: run.messageId, model: run.model, startedAt: run.now })
    .returning({ id: modelRuns.id });
  return row!.id;
}

export async function finishRun(db: Sql, id: number, result: { outcome: RunOutcome; error?: string; usage?: Usage; now: number }): Promise<void> {
  await db
    .update(modelRuns)
    .set({
      outcome: result.outcome,
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
    .where(and(forMessage(accountId, messageId), counted))
    .returning({ id: modelRuns.id });
  return rows.length > 0;
}
