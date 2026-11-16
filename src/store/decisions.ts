import { type DECISION_OUTCOMES, and, asc, decisions, eq, isNull } from './query.ts';
import type { Sql } from './sql.ts';
import type { Decision, Disposition } from '../triage/types.ts';

type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

/**
 * Append a decision to the log. Every triage outcome is recorded, including "leave it alone" and
 * "could not decide", so the log is a complete account of what sift did and what it cost.
 *
 * A suggestion (the default) is final as recorded. One to `carryOut` stays unsettled until
 * `settleDecision` records what happened in the mailbox. `byUser`: it is the user's own answer.
 */
export async function recordDecision(
  db: Sql,
  accountId: string,
  messageId: string,
  decision: Decision,
  options: { carryOut?: boolean; durationMs?: number; now?: number; byUser?: boolean; runId?: number } = {},
): Promise<number> {
  const [row] = await db
    .insert(decisions)
    .values({
      accountId,
      messageId,
      stage: decision.stage,
      disposition: decision.disposition,
      subscription: decision.subscription,
      gmailLabel: decision.gmailLabel ?? null,
      ruleId: decision.ruleId ?? null,
      confidence: decision.confidence ?? null,
      reason: decision.reason,
      runId: options.runId ?? null,
      durationMs: options.durationMs ?? null,
      decidedAt: options.now ?? Date.now(),
      carryOut: options.carryOut ?? false,
      labelId: decision.labelId ?? null,
      block: decision.block ?? false,
      markRead: decision.markRead ?? false,
      priorRuleId: decision.priorRuleId ?? null,
      byUser: options.byUser ?? false,
    })
    .returning({ id: decisions.id });
  return row!.id;
}

export async function settleDecision(db: Sql, id: number, outcome: DecisionOutcome, detail: string | null = null): Promise<void> {
  await db.update(decisions).set({ outcome, outcomeDetail: detail }).where(eq(decisions.id, id));
}

interface UnsettledDecision {
  id: number;
  messageId: string;
  disposition: Disposition;
  gmailLabel?: string;
  markRead?: boolean;
}

/**
 * Decisions to carry out that were recorded but not yet carried out (an answer waiting for the next pass, a crash,
 * a provider error), oldest first. `byUserOnly` keeps only the user's own answers, which are carried out
 * even while sift is off.
 */
export async function listUnsettledDecisions(db: Sql, accountId: string, options: { byUserOnly?: boolean } = {}): Promise<UnsettledDecision[]> {
  const rows = await db
    .select({
      id: decisions.id,
      messageId: decisions.messageId,
      disposition: decisions.disposition,
      gmailLabel: decisions.gmailLabel,
      markRead: decisions.markRead,
    })
    .from(decisions)
    .where(
      and(
        eq(decisions.accountId, accountId),
        eq(decisions.carryOut, true),
        isNull(decisions.outcome),
        options.byUserOnly ? eq(decisions.byUser, true) : undefined,
      ),
    )
    .orderBy(asc(decisions.id));
  return rows.map((r) => ({
    id: r.id,
    messageId: r.messageId,
    disposition: r.disposition,
    ...(r.gmailLabel ? { gmailLabel: r.gmailLabel } : {}),
    ...(r.markRead ? { markRead: true } : {}),
  }));
}
