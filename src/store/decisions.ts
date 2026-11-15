import type { DatabaseSync } from 'node:sqlite';
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
export function recordDecision(
  db: DatabaseSync,
  accountId: string,
  messageId: string,
  decision: Decision,
  options: { mode?: DecisionMode; durationMs?: number; now?: number } = {},
): number {
  const mode = options.mode ?? 'observe';
  const result = db
    .prepare(
      `INSERT INTO decisions
         (account_id, message_id, stage, disposition, subscription, label, rule_id, confidence, reason,
          model, input_tokens, output_tokens, cost_usd, duration_ms, decided_at, mode, outcome, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      accountId,
      messageId,
      decision.stage,
      decision.disposition,
      decision.subscription,
      decision.label ?? null,
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
      decision.category ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function settleDecision(db: DatabaseSync, id: number, outcome: DecisionOutcome, detail: string | null = null): void {
  db.prepare('UPDATE decisions SET outcome = ?, outcome_detail = ? WHERE id = ?').run(outcome, detail, id);
}

export interface UnsettledDecision {
  id: number;
  messageId: string;
  disposition: Disposition;
  label?: string;
}

/** `act` decisions that were recorded but never carried out (a crash or a provider error), oldest first. */
export function listUnsettledDecisions(db: DatabaseSync, accountId: string): UnsettledDecision[] {
  const rows = db
    .prepare(`SELECT id, message_id, disposition, label FROM decisions WHERE account_id = ? AND outcome IS NULL AND mode = 'act' ORDER BY id`)
    .all(accountId) as unknown as { id: number; message_id: string; disposition: Disposition; label: string | null }[];
  return rows.map((r) => ({ id: r.id, messageId: r.message_id, disposition: r.disposition, ...(r.label ? { label: r.label } : {}) }));
}
