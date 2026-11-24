import { and, asc, count, decisions, desc, eq, gte, inboxRuns, isNull, labels, max, messages, modelRuns, rules, sql } from '../../store/query.ts';
import { keptOut, saved } from './saved.ts';
import type { Sql } from '../../store/sql.ts';
import { type RuleMatch } from '../../triage/rule.ts';
import { openEnvelope, openJson, ruleName } from '../../store/content.ts';
import { ruleFilterStatus } from '../../store/filters.ts';
import { type Scope, within } from '../scope.ts';
import type { RuleSummary, RuleUsage, RuleWaiting } from '../types.ts';
import { localDay } from './summary.ts';
import { MONTH } from './usage.ts';
import { isCurrent, ofMessage } from '../../store/decisions.ts';
import { DAY_MS } from '../../time.ts';

/**
 * Every rule in evaluation order, with its label, what it does, how often and how recently it decided a
 * message, and what checking its condition cost over the last 30 days.
 */
export async function listRuleSummaries(db: Sql, scope: Scope, now: number): Promise<RuleSummary[]> {
  // The rules are the person's own; a scope of none of their mailboxes sees none of them.
  if (scope.accounts.length === 0) return [];
  const filters = await ruleFilterStatus(db);
  const checking = and(eq(modelRuns.ruleId, rules.id), gte(modelRuns.startedAt, now - MONTH * DAY_MS));
  const rows = await db
    .select({
      id: rules.id,
      match: rules.match,
      except: rules.except,
      name: rules.name,
      labelId: rules.labelId,
      whenLabel: rules.whenLabel,
      labelName: labels.name,
      override: rules.disposition,
      labelDoes: sql<string | null>`CASE WHEN ${labels.block} THEN 'block' WHEN ${labels.digest} THEN 'digest' ELSE ${labels.disposition} END`,
      markRead: sql<boolean>`coalesce(${rules.markRead} OR ${labels.markRead}, false)`,
      unsubscribe: sql<boolean>`coalesce(${rules.subscription} = 'unsubscribe' OR ${labels.unsubscribe}, false)`,
      condition: rules.condition,
      source: rules.source,
      hits: rules.hits,
      createdAt: rules.createdAt,
      lastHitAt: sql<number | null>`${db
        .select({ at: max(decisions.decidedAt) })
        .from(decisions)
        .where(eq(decisions.ruleId, rules.id))}`.mapWith(Number),
      checks: sql<number>`${db.select({ n: count() }).from(modelRuns).where(checking)}`.mapWith(Number),
      checkCost: sql<number>`${db
        .select({ usd: sql`coalesce(sum(${modelRuns.costUsd}), 0)` })
        .from(modelRuns)
        .where(checking)}`.mapWith(Number),
    })
    .from(rules)
    .leftJoin(labels, eq(labels.id, sql`coalesce(${rules.labelId}, ${rules.whenLabel})`))
    .orderBy(asc(rules.position), asc(rules.id));
  return rows.map((r) => {
    const { filterId, ...filter } = filters.get(r.id) ?? {
      filterId: null,
      state: 'none',
      possible: false,
      reason: null,
      plan: null,
      differs: [],
      checkedAt: null,
      history: [],
    };
    return {
      id: r.id,
      match: openJson<RuleMatch>(db, ruleName(db, r.id, 'match'), r.match),
      except: openJson<RuleMatch[]>(db, ruleName(db, r.id, 'except'), r.except),
      kind: r.labelId !== null ? 'label' : r.whenLabel !== null ? 'when-label' : 'action',
      name: r.name === null ? null : openJson<string>(db, ruleName(db, r.id, 'name'), r.name),
      labelId: r.labelId,
      whenLabel: r.whenLabel,
      labelName: r.labelName,
      override: r.override,
      disposition: r.override ?? r.labelDoes,
      markRead: r.markRead,
      unsubscribe: r.unsubscribe,
      when: r.condition,
      source: r.source,
      hits: r.hits,
      lastHitAt: r.lastHitAt,
      checks: r.checks,
      checkCost: r.checkCost,
      filterId,
      filter,
      createdAt: r.createdAt,
    };
  });
}

/** Shown of what a rule has decided and not carried out; the count says how many in all. */
const MOST_WAITING = 50;

/**
 * Mail a rule decided that Mild has not moved and the user has not answered: it came while Mild was off, or
 * before the rule and was decided again when it was made. Newest first. And how far applying it to the inbox has got.
 */
export async function ruleWaiting(db: Sql, scope: Scope, ruleId: string): Promise<RuleWaiting> {
  const where = and(
    within(scope, decisions.accountId),
    eq(decisions.ruleId, ruleId),
    eq(decisions.carryOut, false),
    eq(decisions.byUser, false),
    isCurrent(db),
  );
  const [total] = await db.select({ n: count() }).from(decisions).where(where);
  const rows = await db
    .select({ accountId: decisions.accountId, messageId: decisions.messageId, headers: messages.headers, receivedAt: messages.receivedAt })
    .from(decisions)
    .innerJoin(messages, ofMessage)
    .where(where)
    .orderBy(desc(messages.receivedAt))
    .limit(MOST_WAITING);
  const [applying] = await db
    .select({ listed: inboxRuns.listed, done: inboxRuns.next, total: sql<number>`jsonb_array_length(${inboxRuns.messages})`.mapWith(Number) })
    .from(inboxRuns)
    .where(and(within(scope, inboxRuns.accountId), eq(inboxRuns.ruleId, ruleId), isNull(inboxRuns.finishedAt)));
  return {
    total: total?.n ?? 0,
    applying: applying ?? null,
    messages: rows.map((r) => {
      const { subject } = openEnvelope(db, r.accountId, r.messageId, r);
      return { accountId: r.accountId, messageId: r.messageId, subject, receivedAt: r.receivedAt };
    }),
  };
}

/**
 * What a rule decided by itself each day over the last 30, as its hit count counts them, and what the
 * model calls that checked its condition cost, met or not.
 */
export async function ruleUsage(db: Sql, scope: Scope, ruleId: string, now: number): Promise<RuleUsage> {
  const since = now - MONTH * DAY_MS;
  const byDay = new Map<string, { changed: number; left: number; costUsd: number }>();
  for (let i = MONTH - 1; i >= 0; i--) byDay.set(localDay(now - i * DAY_MS), { changed: 0, left: 0, costUsd: 0 });
  const decided = await db
    .select({ decidedAt: decisions.decidedAt, outcome: decisions.outcome })
    .from(decisions)
    .where(and(within(scope, decisions.accountId), eq(decisions.ruleId, ruleId), eq(decisions.byUser, false), gte(decisions.decidedAt, since)));
  for (const row of decided) {
    const day = byDay.get(localDay(row.decidedAt));
    if (!day) continue;
    if (row.outcome === 'done') day.changed++;
    else day.left++;
  }
  const checks = await db
    .select({ startedAt: modelRuns.startedAt, costUsd: modelRuns.costUsd })
    .from(modelRuns)
    .where(and(within(scope, modelRuns.accountId), eq(modelRuns.ruleId, ruleId), gte(modelRuns.startedAt, since)));
  for (const run of checks) {
    const day = byDay.get(localDay(run.startedAt));
    if (day) day.costUsd += run.costUsd;
  }
  return {
    daily: [...byDay].map(([day, rest]) => ({ day, ...rest })),
    saved: saved((await keptOut(db, scope, since, { where: eq(decisions.ruleId, ruleId) })).length),
  };
}
