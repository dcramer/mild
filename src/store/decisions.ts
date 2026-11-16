import { type DECISION_MODES, type DECISION_OUTCOMES, and, asc, decisions, eq, isNull } from './query.ts';
import type { Sql } from './sql.ts';
import type { Decision, Disposition } from '../triage/types.ts';

export type DecisionMode = (typeof DECISION_MODES)[number];
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

/**
 * Append a decision to the log. Every triage outcome is recorded, including "leave it alone" and
 * "could not decide", so the log is a complete account of what sift did and what it cost.
 *
 * In `observe` mode (the default) the decision is final as recorded. In `act` mode it stays
 * unsettled until `settleDecision` records what happened in the mailbox.
 */
export async function recordDecision(
  db: Sql,
  accountId: string,
  messageId: string,
  decision: Decision,
  options: { mode?: DecisionMode; durationMs?: number; now?: number; byUser?: boolean } = {},
): Promise<number> {
  const mode = options.mode ?? 'observe';
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
      model: decision.usage?.model ?? null,
      inputTokens: decision.usage?.inputTokens ?? 0,
      outputTokens: decision.usage?.outputTokens ?? 0,
      costUsd: decision.usage?.costUsd ?? 0,
      durationMs: options.durationMs ?? null,
      decidedAt: options.now ?? Date.now(),
      mode,
      outcome: mode === 'observe' ? 'observed' : null,
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

export interface UnsettledDecision {
  id: number;
  messageId: string;
  disposition: Disposition;
  gmailLabel?: string;
  markRead?: boolean;
}

/**
 * `act` decisions that were recorded but not yet carried out (an answer waiting for the next pass, a crash,
 * a provider error), oldest first. `byUserOnly` keeps only the user's own answers, which are carried out
 * even while sift only observes.
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
        isNull(decisions.outcome),
        eq(decisions.mode, 'act'),
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
