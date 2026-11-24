import {
  type SQL,
  actions,
  alias,
  and,
  decisions,
  desc,
  eq,
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
import { hashOf, openEnvelope } from '../../store/content.ts';
import { type Scope, within } from '../scope.ts';
import { type DecisionRow, FACT_FILTERS, FACT_FILTER_KEYS, type ListedDecision } from '../types.ts';
import { factsWhere } from '../../store/messages.ts';
import { contacts } from '../../store/senders.ts';
import { LEAVE_IN_INBOX } from '../../triage/types.ts';
import { plain } from '../../plain.ts';
import { ofMessage } from '../../store/decisions.ts';

export const DAY_MS = 86_400_000;

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value);

const latest = alias(actions, 'latest');

/** The columns a decision is shown with. */
const DECISION_FIELDS = {
  id: decisions.id,
  accountId: decisions.accountId,
  messageId: decisions.messageId,
  decidedAt: decisions.decidedAt,
  receivedAt: messages.receivedAt,
  stage: decisions.stage,
  disposition: decisions.disposition,
  block: decisions.block,
  digest: decisions.digest,
  subscription: decisions.subscription,
  labelId: decisions.labelId,
  labelName: labels.name,
  gmailLabel: labels.gmailLabel,
  reason: decisions.reason,
  confidence: decisions.confidence,
  model: modelRuns.model,
  costUsd: sql<number>`coalesce(${modelRuns.costUsd}, 0)`.mapWith(Number),
  headers: messages.headers,
  carryOut: decisions.carryOut,
  outcome: decisions.outcome,
  outcomeDetail: decisions.outcomeDetail,
  byUser: decisions.byUser,
  actionId: actions.id,
  actionStatus: actions.status,
};

/** Decisions with their message, their label, and the last change made for each other than unsubscribing. */
export const decisionsJoined = (db: Sql) =>
  db
    .select(DECISION_FIELDS)
    .from(decisions)
    .innerJoin(messages, ofMessage)
    .leftJoin(labels, eq(labels.id, decisions.labelId))
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

/** Where a decision has got to, as the dashboard groups it. */
const STATUS_WHERE: Record<string, SQL | undefined> = {
  suggested: eq(decisions.carryOut, false),
  done: and(eq(decisions.carryOut, true), inArray(decisions.outcome, ['done', 'none']), sql`coalesce(${actions.status}, 'done') = 'done'`),
  undone: eq(actions.status, 'undone'),
  // What was done to mail in Gmail, tried, or waiting to be: suggestions and mail left alone are not.
  changed: and(eq(decisions.carryOut, true), or(isNotNull(actions.id), isNull(decisions.outcome), inArray(decisions.outcome, ['failed', 'unknown']))),
};

type DecisionFields = Awaited<ReturnType<typeof decisionsJoined>>[number];

export const toDecisionRow = (db: Sql, { block, digest, subscription, ...r }: DecisionFields): DecisionRow => ({
  ...openEnvelope(db, r.accountId, r.messageId, r),
  disposition: block ? 'block' : digest ? 'digest' : r.disposition,
  unsubscribe: subscription === 'unsubscribe',
  // Anything but a skip's own sentence can be the text of an error from Gmail.
  outcomeDetail: r.outcome === 'skipped' ? r.outcomeDetail : null,
});

/** Decisions as the label `id`. Leave in inbox also takes mail kept with no label, as every list names it. */
export const labelIs = (id: string) =>
  id === LEAVE_IN_INBOX
    ? or(eq(decisions.labelId, LEAVE_IN_INBOX), and(isNull(decisions.labelId), eq(decisions.disposition, 'keep')))
    : eq(decisions.labelId, id);

interface DecisionFilter {
  days: number;
  /** `suggested`, `done`, `undone` or `changed`. */
  status?: string;
  /** Case-insensitive substring of the subject, sender address or sender name. Reads every decision the rest of the filter leaves. */
  search?: string;
  accountId?: string;
  /** Exact sender address. */
  sender?: string;
  /** Exact sender domain. */
  domain?: string;
  /** One of `FACT_FILTERS`. */
  fact?: string;
  /** A label's id (`labelIs`). */
  label?: string;
  limit?: number;
  offset?: number;
}

/** Decisions in the window, newest first, with the total number that match the filter. Unknown filter values match nothing. */
export async function listDecisions(
  db: Sql,
  scope: Scope,
  filter: DecisionFilter,
  now: number = Date.now(),
): Promise<{ total: number; rows: ListedDecision[] }> {
  const where: (SQL | undefined)[] = [within(scope, decisions.accountId), gte(decisions.decidedAt, now - filter.days * DAY_MS)];
  if (filter.status !== undefined) {
    const clause = STATUS_WHERE[filter.status];
    if (clause === undefined) return { total: 0, rows: [] };
    where.push(clause);
  }
  if (filter.accountId !== undefined) where.push(eq(decisions.accountId, filter.accountId));
  if (filter.sender !== undefined) where.push(eq(messages.senderHash, hashOf(db, filter.sender)));
  if (filter.domain !== undefined) where.push(eq(messages.domainHash, hashOf(db, filter.domain)));
  if (filter.fact !== undefined) {
    if (!isOneOf(FACT_FILTER_KEYS, filter.fact)) return { total: 0, rows: [] };
    where.push(factsWhere(FACT_FILTERS[filter.fact]));
  }
  if (filter.label !== undefined) where.push(labelIs(filter.label));
  const clause = and(...where);
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const search = filter.search?.trim().toLowerCase();
  let total: number;
  let rows: DecisionRow[];
  if (search) {
    // Subjects and names are encrypted, so the database cannot look inside them.
    const found = (await decisionsJoined(db).where(clause).orderBy(desc(decisions.id)))
      .map((r) => toDecisionRow(db, r))
      .filter((r) => [r.subject, r.fromAddress, r.fromName].some((s) => plain(s)?.toLowerCase().includes(search)));
    total = found.length;
    rows = found.slice(offset, offset + limit);
  } else {
    [{ total }] = (await db.select({ total: count() }).from(decisionsJoined(db).where(clause).as('matching'))) as [{ total: number }];
    rows = (await decisionsJoined(db).where(clause).orderBy(desc(decisions.id)).limit(limit).offset(offset)).map((r) => toDecisionRow(db, r));
  }
  const known = await contacts(
    db,
    scope.accounts,
    rows.map((r) => plain(r.fromAddress)),
  );
  return { total, rows: rows.map((r) => ({ ...r, contact: known.get(plain(r.fromAddress)) ?? null })) };
}
