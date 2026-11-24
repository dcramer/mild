import {
  type AnyColumn,
  type DECISION_OUTCOMES,
  type SQL,
  alias,
  and,
  asc,
  decisions,
  desc,
  eq,
  feedback,
  isNull,
  labels,
  max,
  messages,
  ne,
} from './query.ts';
import type { Sql } from './sql.ts';
import { openPart, sealPart } from './content.ts';
import type { Decision, Disposition } from '../triage/types.ts';
import { plain } from '../plain.ts';

const later = alias(decisions, 'later');

/**
 * True on a message's current decision, the newest recorded for it. The message is named by the decision's own
 * columns unless given, as where a join has the message before the decision.
 */
export const isCurrent = (db: Sql, accountId: AnyColumn | SQL.Aliased = decisions.accountId, messageId: AnyColumn | SQL.Aliased = decisions.messageId) =>
  eq(
    decisions.id,
    db
      .select({ id: max(later.id) })
      .from(later)
      .where(and(eq(later.accountId, accountId), eq(later.messageId, messageId))),
  );

/** Joins `messages` to `decisions`. */
export const ofMessage = and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId));

/** A decision's label, whose Gmail label is the one the decision applies. */
const ofLabel = eq(labels.id, decisions.labelId);

type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

/**
 * Append a decision to the log. Every triage outcome is recorded, including "leave it alone" and
 * "could not decide", so the log is a complete account of what Mild did and what it cost.
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
      ruleId: decision.ruleId ?? null,
      confidence: decision.confidence ?? null,
      reason: sealPart(db, accountId, messageId, 'reason', decision.reason)!,
      runId: options.runId ?? null,
      durationMs: options.durationMs ?? null,
      decidedAt: options.now ?? Date.now(),
      carryOut: options.carryOut ?? false,
      labelId: decision.labelId ?? null,
      block: decision.block ?? false,
      digest: decision.digest ?? false,
      markRead: decision.markRead ?? false,
      byUser: options.byUser ?? false,
    })
    .returning({ id: decisions.id });
  // An earlier decision still waiting to be carried out is replaced, never carried out after: an answer of Leave in inbox
  // given while Mild's archive waited on a retry would otherwise see the mail archived by the next pass.
  await db
    .update(decisions)
    .set({ outcome: 'skipped', outcomeDetail: 'replaced by a later decision' })
    .where(
      and(
        eq(decisions.accountId, accountId),
        eq(decisions.messageId, messageId),
        eq(decisions.carryOut, true),
        isNull(decisions.outcome),
        ne(decisions.id, row!.id),
      ),
    );
  await db
    .update(messages)
    .set({ decided: true })
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId), eq(messages.decided, false)));
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
 * even while Mild is off.
 */
export async function listUnsettledDecisions(db: Sql, accountId: string, options: { byUserOnly?: boolean } = {}): Promise<UnsettledDecision[]> {
  const rows = await db
    .select({
      id: decisions.id,
      messageId: decisions.messageId,
      disposition: decisions.disposition,
      gmailLabel: labels.gmailLabel,
      markRead: decisions.markRead,
    })
    .from(decisions)
    .leftJoin(labels, ofLabel)
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

/**
 * A message's current decision, rebuilt as a decision, and whether the user has had their say on the message
 * (answered it, or pressed for what was done). Null when nothing has decided it.
 */
export async function currentDecision(
  db: Sql,
  accountId: string,
  messageId: string,
): Promise<{
  id: number;
  decision: Decision;
  carryOut: boolean;
  /** Null while it waits to be carried out, and for a suggestion. */
  outcome: (typeof DECISION_OUTCOMES)[number] | null;
  decidedAt: number;
  runId: number | null;
  answered: boolean;
} | null> {
  const rows = await db
    .select({ decision: decisions, gmailLabel: labels.gmailLabel })
    .from(decisions)
    .leftJoin(labels, ofLabel)
    .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId)))
    .orderBy(desc(decisions.id));
  if (!rows[0]) return null;
  const { decision: row, gmailLabel } = rows[0];
  const answers = await db
    .select({ id: feedback.id })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId)))
    .limit(1);
  const decision: Decision = {
    disposition: row.disposition,
    subscription: row.subscription,
    stage: row.stage,
    reason: plain(openPart(db, accountId, messageId, 'reason', row.reason))!,
    ...(row.labelId === null ? {} : { labelId: row.labelId }),
    ...(gmailLabel === null ? {} : { gmailLabel }),
    ...(row.block ? { block: true } : {}),
    ...(row.digest ? { digest: true } : {}),
    ...(row.markRead ? { markRead: true } : {}),
    ...(row.ruleId === null ? {} : { ruleId: row.ruleId }),
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
  };
  return {
    id: row.id,
    decision,
    carryOut: row.carryOut,
    outcome: row.outcome,
    decidedAt: row.decidedAt,
    runId: row.runId,
    answered: answers.length > 0 || rows.some((r) => r.decision.byUser),
  };
}
