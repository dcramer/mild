import { type AnyColumn, and, avg, count, decisions, desc, eq, gt, inArray, isNotNull, isNull, modelRuns, notExists, sql } from './query.ts';
import type { Sql } from './sql.ts';
import { type Usage } from '../triage/types.ts';

/** A message the model has failed on this many times is not asked about again: it is the user's to say what it is. */
export const MAX_ATTEMPTS = 3;
/** Enough for what a provider says went wrong. */
const MAX_ERROR = 500;

/**
 * A call that counts against its message: one no decision came of (it failed, was cut short, or its
 * verdict was never recorded), unless it was part of an outage.
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

/** A call's usage, as the columns every row of a model call keeps it in. */
export const costOf = (usage: Usage | undefined) => (usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : {});

/** Stamped before the call, so a pass that stops part-way leaves a run that counts as failed. */
export async function startRun(db: Sql, run: { accountId: string; messageId: string; model: string; ruleId?: string; now: number }): Promise<number> {
  const [row] = await db
    .insert(modelRuns)
    .values({ accountId: run.accountId, messageId: run.messageId, model: run.model, ruleId: run.ruleId ?? null, startedAt: run.now })
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

/** How many calls an average is taken over: enough that one long message does not sway it, recent enough to follow the labels and prompt as they are now. */
const RECENT_CALLS = 200;
/** Fewer answered calls than this and an average says more about those messages than about the mailbox. */
const ENOUGH_CALLS = 20;

/**
 * What a call about a message has averaged lately, on `model` or on any; null with too few answered to go by.
 * A call whose provider reported no usage says nothing of its size or cost, so it is left out.
 */
export async function averageCall(db: Sql, model?: string): Promise<{ costUsd: number; inputTokens: number; outputTokens: number } | null> {
  const recent = db
    .select({ costUsd: modelRuns.costUsd, inputTokens: modelRuns.inputTokens, outputTokens: modelRuns.outputTokens })
    .from(modelRuns)
    .where(
      and(model === undefined ? undefined : eq(modelRuns.model, model), isNotNull(modelRuns.finishedAt), isNull(modelRuns.error), gt(modelRuns.inputTokens, 0)),
    )
    .orderBy(desc(modelRuns.id))
    .limit(RECENT_CALLS)
    .as('recent');
  const [row] = await db
    .select({
      n: count(),
      costUsd: avg(recent.costUsd).mapWith(Number),
      inputTokens: avg(recent.inputTokens).mapWith(Number),
      outputTokens: avg(recent.outputTokens).mapWith(Number),
    })
    .from(recent);
  return row && row.n >= ENOUGH_CALLS ? { costUsd: row.costUsd, inputTokens: row.inputTokens, outputTokens: row.outputTokens } : null;
}

/** Failures that say nothing about their messages (the provider was down): they stop counting, as if put back. */
export async function excuseRuns(db: Sql, ids: readonly number[], now: number): Promise<void> {
  if (ids.length > 0) await db.update(modelRuns).set({ retriedAt: now }).where(inArray(modelRuns.id, ids));
}
