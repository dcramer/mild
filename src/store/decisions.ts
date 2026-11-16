import type { Sql } from './sql.ts';
import type { Decision, Disposition } from '../triage/types.ts';

export type DecisionMode = 'act' | 'observe';
export type DecisionOutcome = 'observed' | 'none' | 'done' | 'skipped' | 'failed' | 'unknown';

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
  const result = await db.get<{ id: number }>(
    `INSERT INTO decisions
         (account_id, message_id, stage, disposition, subscription, gmail_label, rule_id, confidence, reason,
          model, input_tokens, output_tokens, cost_usd, duration_ms, decided_at, mode, outcome, label_id, block, mark_read, prior_rule_id, by_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    accountId,
    messageId,
    decision.stage,
    decision.disposition,
    decision.subscription,
    decision.gmailLabel ?? null,
    decision.ruleId ?? null,
    decision.confidence ?? null,
    decision.reason,
    decision.usage?.model ?? null,
    decision.usage?.inputTokens ?? 0,
    decision.usage?.outputTokens ?? 0,
    decision.usage?.costUsd ?? 0,
    options.durationMs ?? null,
    options.now ?? Date.now(),
    mode,
    mode === 'observe' ? 'observed' : null,
    decision.labelId ?? null,
    decision.block ? 1 : 0,
    decision.markRead ? 1 : 0,
    decision.priorRuleId ?? null,
    options.byUser ? 1 : 0,
  );
  return result!.id;
}

export async function settleDecision(db: Sql, id: number, outcome: DecisionOutcome, detail: string | null = null): Promise<void> {
  await db.run('UPDATE decisions SET outcome = ?, outcome_detail = ? WHERE id = ?', outcome, detail, id);
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
  const rows = await db.all<{ id: number; message_id: string; disposition: Disposition; gmail_label: string | null; mark_read: number }>(
    `SELECT id, message_id, disposition, gmail_label, mark_read FROM decisions
       WHERE account_id = ? AND outcome IS NULL AND mode = 'act' ${options.byUserOnly ? 'AND by_user = 1' : ''} ORDER BY id`,
    accountId,
  );
  return rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    disposition: r.disposition,
    ...(r.gmail_label ? { gmailLabel: r.gmail_label } : {}),
    ...(r.mark_read === 1 ? { markRead: true } : {}),
  }));
}
