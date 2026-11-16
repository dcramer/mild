import {
  type SQL,
  actions,
  alias,
  and,
  decisions,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  labels,
  max,
  messages,
  modelRuns,
  ne,
  or,
  sql,
  count,
  gte,
} from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { DISPOSITIONS } from '../../triage/types.ts';
import { type Scope, within } from '../scope.ts';
import { type DecisionRow, STAGES, type ChangeRow } from '../types.ts';

export const DAY_MS = 86_400_000;

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value);

const latest = alias(actions, 'latest');

/** The columns a decision is shown with. */
const DECISION_FIELDS = {
  id: decisions.id,
  accountId: decisions.accountId,
  messageId: decisions.messageId,
  decidedAt: decisions.decidedAt,
  stage: decisions.stage,
  disposition: decisions.disposition,
  block: decisions.block,
  subscription: decisions.subscription,
  labelId: decisions.labelId,
  labelName: labels.name,
  gmailLabel: decisions.gmailLabel,
  reason: decisions.reason,
  confidence: decisions.confidence,
  model: modelRuns.model,
  costUsd: sql<number>`coalesce(${modelRuns.costUsd}, 0)`.mapWith(Number),
  fromAddress: messages.fromAddress,
  fromName: messages.fromName,
  subject: messages.subject,
  carryOut: decisions.carryOut,
  outcome: decisions.outcome,
  outcomeDetail: decisions.outcomeDetail,
  byUser: decisions.byUser,
  actionId: actions.id,
  actionType: actions.type,
  actionStatus: actions.status,
};

/** Decisions with their message, their label, and the last change made for each other than unsubscribing. */
export const decisionsJoined = (db: Sql) =>
  db
    .select(DECISION_FIELDS)
    .from(decisions)
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .leftJoin(labels, and(eq(labels.accountId, decisions.accountId), eq(labels.id, decisions.labelId)))
    .leftJoin(modelRuns, eq(modelRuns.id, decisions.runId))
    .leftJoin(
      actions,
      eq(
        actions.id,
        db
          .select({ id: max(latest.id) })
          .from(latest)
          .where(and(eq(latest.decisionId, decisions.id), ne(latest.type, 'unsubscribe'))),
      ),
    );

/**
 * Where a decision has got to, as the dashboard groups it. `trouble`: failed or not confirmed. A change
 * still waiting for a pass (an answer, or anything left while sift was off) is not trouble.
 */
const STATUS_WHERE: Record<string, SQL | undefined> = {
  suggested: eq(decisions.carryOut, false),
  done: and(eq(decisions.carryOut, true), inArray(decisions.outcome, ['done', 'none']), sql`coalesce(${actions.status}, 'done') = 'done'`),
  undone: eq(actions.status, 'undone'),
  trouble: and(
    eq(decisions.carryOut, true),
    isNotNull(decisions.outcome),
    sql`coalesce(${actions.status}, '') NOT IN ('pending', 'undone')`,
    or(inArray(decisions.outcome, ['failed', 'unknown']), inArray(actions.status, ['failed', 'unknown'])),
  ),
  // What was done to mail in Gmail, tried, or waiting to be: suggestions and mail left alone are not.
  changed: and(eq(decisions.carryOut, true), or(isNotNull(actions.id), isNull(decisions.outcome), inArray(decisions.outcome, ['failed', 'unknown']))),
};

/**
 * Try a failed or unconfirmed change again: the decision goes back to waiting, and the next pass carries it
 * out through the executor as it would any other. The user's own answer is retried even while sift is
 * off; anything else waits for sift to be on. False if there was nothing to retry.
 */
export async function retryDecision(db: Sql, scope: Scope, id: number): Promise<{ retried: boolean; waiting: boolean }> {
  const [row] = await db
    .select({ byUser: decisions.byUser })
    .from(decisions)
    .where(and(eq(decisions.id, id), eq(decisions.carryOut, true), inArray(decisions.outcome, ['failed', 'unknown']), within(scope, decisions.accountId)));
  if (!row) return { retried: false, waiting: false };
  await db.update(decisions).set({ outcome: null, outcomeDetail: null }).where(eq(decisions.id, id));
  return { retried: true, waiting: !row.byUser };
}

type DecisionFields = Awaited<ReturnType<typeof decisionsJoined>>[number];

export const toDecisionRow = ({ block, subscription, ...r }: DecisionFields): DecisionRow => ({
  ...r,
  disposition: block ? 'block' : r.disposition,
  unsubscribe: subscription === 'unsubscribe',
});

interface DecisionFilter {
  days: number;
  stage?: string;
  disposition?: string;
  /** `suggested`, `done`, `undone` or `trouble`. */
  status?: string;
  /** Case-insensitive substring of the subject, sender address or sender name. */
  search?: string;
  accountId?: string;
  /** Exact sender address. */
  sender?: string;
  /** Exact sender domain. */
  domain?: string;
  limit?: number;
  offset?: number;
}

/** Decisions in the window, newest first, with the total number that match the filter. Unknown filter values match nothing. */
export async function listDecisions(db: Sql, scope: Scope, filter: DecisionFilter, now: number = Date.now()): Promise<{ total: number; rows: DecisionRow[] }> {
  const where: (SQL | undefined)[] = [within(scope, decisions.accountId), gte(decisions.decidedAt, now - filter.days * DAY_MS)];
  if (filter.stage !== undefined) {
    if (!isOneOf(STAGES, filter.stage)) return { total: 0, rows: [] };
    where.push(eq(decisions.stage, filter.stage));
  }
  if (filter.disposition !== undefined) {
    if (!isOneOf(DISPOSITIONS, filter.disposition)) return { total: 0, rows: [] };
    where.push(eq(decisions.disposition, filter.disposition));
  }
  if (filter.status !== undefined) {
    const clause = STATUS_WHERE[filter.status];
    if (clause === undefined) return { total: 0, rows: [] };
    where.push(clause);
  }
  if (filter.accountId !== undefined) where.push(eq(decisions.accountId, filter.accountId));
  if (filter.sender !== undefined) where.push(eq(messages.fromAddress, filter.sender));
  if (filter.domain !== undefined) where.push(eq(messages.fromDomain, filter.domain));
  const search = filter.search?.trim();
  if (search) {
    // Backslash is ILIKE's escape character unless told otherwise.
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(or(ilike(messages.subject, pattern), ilike(messages.fromAddress, pattern), ilike(sql`coalesce(${messages.fromName}, '')`, pattern)));
  }
  const clause = and(...where);
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const [{ total }] = (await db.select({ total: count() }).from(decisionsJoined(db).where(clause).as('matching'))) as [{ total: number }];
  const rows = await decisionsJoined(db).where(clause).orderBy(desc(decisions.id)).limit(limit).offset(offset);
  return { total, rows: rows.map(toDecisionRow) };
}

/** Changes sift made to the mailbox, newest first, with the message each was about. */
export async function listChanges(db: Sql, scope: Scope, limit: number): Promise<ChangeRow[]> {
  const rows = await db
    .select({
      id: actions.id,
      accountId: actions.accountId,
      messageId: actions.messageId,
      type: actions.type,
      status: actions.status,
      error: actions.error,
      createdAt: actions.createdAt,
      payload: actions.payload,
      subject: messages.subject,
      fromAddress: messages.fromAddress,
    })
    .from(actions)
    .leftJoin(messages, and(eq(messages.accountId, actions.accountId), eq(messages.id, actions.messageId)))
    .where(and(isNotNull(actions.messageId), within(scope, actions.accountId)))
    .orderBy(desc(actions.id))
    .limit(limit);
  return rows.map(({ payload, ...r }) => ({
    ...r,
    messageId: r.messageId!,
    undoOf: payload.undoOf ?? null,
  }));
}
