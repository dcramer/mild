import {
  type SQL,
  and,
  asc,
  count,
  decisions,
  desc,
  eq,
  feedback,
  gte,
  inArray,
  isNotNull,
  labels,
  messages,
  min,
  ne,
  not,
  notExists,
  or,
  rules,
  sql,
} from './query.ts';
import type { Sql } from './sql.ts';
import { hashOf, openEnvelope } from './content.ts';
import { isCurrent, ofMessage } from './decisions.ts';
import { factsWhere } from './messages.ts';
import type { RuleFacts } from '../triage/facts.ts';
import type { Disposition, StageName } from '../triage/types.ts';
import type { Confidential } from '../confidential.ts';

/** A decision Mild only suggested, that the user has not yet confirmed or corrected. */
export interface Suggestion {
  decisionId: number;
  accountId: string;
  messageId: string;
  stage: StageName;
  disposition: Disposition;
  /** With `spam`: Mild would also block the sender. */
  block: boolean;
  /** With `archive`: Mild would list it in its label's digest. */
  digest: boolean;
  /** The label Mild gave it, or null if it could not place it. */
  labelId: string | null;
  /** Carried out: Mild was on, so it is in Gmail with the review label, asked about there. */
  carriedOut: boolean;
  confidence: number | null;
  decidedAt: number;
  receivedAt: number;
  fromAddress: Confidential;
  fromName: Confidential | null;
  subject: Confidential;
}

const SUGGESTION = {
  decisionId: decisions.id,
  accountId: decisions.accountId,
  messageId: decisions.messageId,
  stage: decisions.stage,
  disposition: decisions.disposition,
  block: decisions.block,
  digest: decisions.digest,
  labelId: decisions.labelId,
  carriedOut: decisions.carryOut,
  confidence: decisions.confidence,
  decidedAt: decisions.decidedAt,
  receivedAt: messages.receivedAt,
  headers: messages.headers,
};

const toSuggestion = (db: Sql, r: Omit<Suggestion, 'fromAddress' | 'fromName' | 'subject'> & { headers: string }): Suggestion =>
  openEnvelope(db, r.accountId, r.messageId, r);

/**
 * Suggestions waiting on the user, newest first: the current decision for a message, recorded as
 * a suggestion or, while Mild was on, left for the user to say, with no answer yet. Decisions that only
 * repeat what the user already told Mild (their answers, and rules they wrote or made by correcting it)
 * are not suggestions and are left out; ones from a rule Mild learned are.
 */
export async function pendingSuggestions(
  db: Sql,
  filter: { accountId?: string; accounts?: readonly string[]; sender?: string; facts?: RuleFacts; since?: number; limit?: number } = {},
): Promise<Suggestion[]> {
  const rows = await db
    .select(SUGGESTION)
    .from(decisions)
    .innerJoin(messages, ofMessage)
    .leftJoin(rules, eq(rules.id, decisions.ruleId))
    .where(waiting(db, filter))
    .orderBy(desc(decisions.decidedAt), desc(decisions.id))
    .limit(filter.limit ?? 5000);
  return rows.map((r) => toSuggestion(db, r));
}

/** How many of `pendingSuggestions` would leave the mail where it is not: what For review counts in the masthead. Nothing is decrypted. */
export async function waitingCount(db: Sql, accounts: readonly string[]): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(decisions)
    .innerJoin(messages, ofMessage)
    .leftJoin(rules, eq(rules.id, decisions.ruleId))
    .where(and(waiting(db, { accounts }), ne(decisions.disposition, 'keep')));
  return row?.n ?? 0;
}

const waiting = (db: Sql, filter: { accountId?: string; accounts?: readonly string[]; sender?: string; facts?: RuleFacts; since?: number }) =>
  and(
    isCurrent(db),
    // Mail Mild asked about while on is waiting on the user as much as what it would have done while off.
    or(eq(decisions.carryOut, false), eq(decisions.disposition, 'review')),
    eq(decisions.byUser, false),
    notExists(
      db
        .select({ one: sql`1` })
        .from(feedback)
        .where(eq(feedback.decisionId, decisions.id)),
    ),
    not(and(isNotNull(decisions.ruleId), ne(sql`coalesce(${rules.source}, 'user')`, 'learned'))!),
    filter.accounts === undefined ? undefined : inArray(decisions.accountId, filter.accounts),
    filter.accountId === undefined ? undefined : eq(decisions.accountId, filter.accountId),
    filter.sender === undefined ? undefined : eq(messages.senderHash, hashOf(db, filter.sender)),
    filter.facts === undefined ? undefined : factsWhere(filter.facts),
    filter.since === undefined ? undefined : gte(decisions.decidedAt, filter.since),
  );

/** The decision that currently stands for a message, in the shape of a suggestion, or null if it has none. */
export async function currentSuggestion(db: Sql, accountId: string, messageId: string): Promise<Suggestion | null> {
  const [row] = await db
    .select(SUGGESTION)
    .from(decisions)
    .innerJoin(messages, ofMessage)
    .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId)))
    .orderBy(desc(decisions.id))
    .limit(1);
  return row ? toSuggestion(db, row) : null;
}

export interface Accuracy {
  reviewed: number;
  right: number;
  /** Per tier that made the suggestion. Tiers with no answers are absent. */
  byStage: { stage: StageName; reviewed: number; right: number }[];
  /** Per label Mild gave, most answers first. */
  byLabel: { labelId: string; labelName: string; reviewed: number; right: number }[];
  /** What Mild called one label when the user said another, commonest first. */
  confusion: { suggested: string; correct: string; count: number }[];
}

/**
 * How often Mild's suggestions matched what the user wanted, from the answers given since `since`.
 * An answer to mail Mild could not place is not counted: having no suggestion is not being wrong.
 */
export async function accuracy(db: Sql, since = 0, accounts?: readonly string[]): Promise<Accuracy> {
  const right = sql<number>`count(*) FILTER (WHERE ${feedback.verdict} = 'right')`.mapWith(Number);
  const scored = (...also: SQL[]) =>
    and(
      inArray(feedback.verdict, ['right', 'wrong']),
      gte(feedback.createdAt, since),
      // Given, only these accounts' answers count; none given means none count.
      accounts === undefined ? undefined : inArray(feedback.accountId, accounts),
      ...also,
    );
  const byStage = await db
    .select({ stage: decisions.stage, reviewed: count(), right })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .where(scored())
    .groupBy(decisions.stage)
    .orderBy(asc(decisions.stage));
  const byLabel = (await db
    .select({ labelId: decisions.labelId, labelName: min(labels.name), reviewed: count(), right })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .innerJoin(labels, eq(labels.id, decisions.labelId))
    .where(scored())
    .groupBy(decisions.labelId)
    .orderBy(desc(count()), asc(decisions.labelId))) as { labelId: string; labelName: string; reviewed: number; right: number }[];
  const confusion = (await db
    .select({ suggested: decisions.labelId, correct: feedback.labelId, count: count() })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .where(scored(eq(feedback.verdict, 'wrong'), isNotNull(decisions.labelId), isNotNull(feedback.labelId)))
    .groupBy(decisions.labelId, feedback.labelId)
    .orderBy(desc(count()), asc(decisions.labelId), asc(feedback.labelId))) as { suggested: string; correct: string; count: number }[];
  return {
    reviewed: byStage.reduce((sum, r) => sum + r.reviewed, 0),
    right: byStage.reduce((sum, r) => sum + r.right, 0),
    byStage,
    byLabel,
    confusion,
  };
}
