import { alias, and, asc, count, decisions, desc, eq, gte, labels, max, messages, modelRuns, rules, sql } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import type { RuleMatch } from '../../triage/stages/rules.ts';
import { openEnvelope, openJson, ruleName } from '../../store/content.ts';
import { ruleFilterStatus } from '../../store/filters.ts';
import { type Scope, within } from '../scope.ts';
import type { RuleSummary, RuleWaiting } from '../types.ts';
import { DAY_MS } from './decisions.ts';
import { MONTH } from './usage.ts';

/**
 * Every rule in evaluation order, with its label, what it does, how often and how recently it decided a
 * message, and what checking its condition cost over the last 30 days.
 */
export async function listRuleSummaries(db: Sql, scope: Scope, now: number): Promise<RuleSummary[]> {
  const filters = await ruleFilterStatus(db);
  const checking = and(eq(modelRuns.accountId, rules.accountId), eq(modelRuns.ruleId, rules.id), gte(modelRuns.startedAt, now - MONTH * DAY_MS));
  const rows = await db
    .select({
      id: rules.id,
      accountId: rules.accountId,
      match: rules.match,
      except: rules.except,
      name: rules.name,
      labelId: rules.labelId,
      whenLabel: rules.whenLabel,
      labelName: labels.name,
      override: rules.disposition,
      labelDoes: sql<string | null>`CASE WHEN ${labels.block} THEN 'block' ELSE ${labels.disposition} END`,
      markRead: sql<boolean>`coalesce(${rules.markRead} OR ${labels.markRead}, false)`,
      unsubscribe: sql<boolean>`coalesce(${rules.subscription} = 'unsubscribe' OR ${labels.unsubscribe}, false)`,
      condition: rules.condition,
      source: rules.source,
      hits: rules.hits,
      filterId: rules.filterId,
      createdAt: rules.createdAt,
      lastHitAt: sql<number | null>`${db
        .select({ at: max(decisions.decidedAt) })
        .from(decisions)
        .where(and(eq(decisions.accountId, rules.accountId), eq(decisions.ruleId, rules.id)))}`.mapWith(Number),
      checks: sql<number>`${db.select({ n: count() }).from(modelRuns).where(checking)}`.mapWith(Number),
      checkCost: sql<number>`${db
        .select({ usd: sql`coalesce(sum(${modelRuns.costUsd}), 0)` })
        .from(modelRuns)
        .where(checking)}`.mapWith(Number),
    })
    .from(rules)
    .leftJoin(labels, and(eq(labels.accountId, rules.accountId), eq(labels.id, sql`coalesce(${rules.labelId}, ${rules.whenLabel})`)))
    .where(within(scope, rules.accountId))
    .orderBy(asc(rules.accountId), asc(rules.position), asc(rules.id));
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
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
    filterId: r.filterId,
    filter: filters.get(r.id) ?? { state: 'none', possible: false, reason: null, plan: null, differs: [], checkedAt: null, history: [] },
    createdAt: r.createdAt,
  }));
}

/** Shown of what a rule has decided and not carried out; the count says how many in all. */
const MOST_WAITING = 50;

/**
 * Mail a rule decided that Sift has not moved and the user has not answered: it came while Sift was off, or
 * before the rule and was decided again when it was made. Newest first.
 */
export async function ruleWaiting(db: Sql, scope: Scope, ruleId: string): Promise<RuleWaiting> {
  const later = alias(decisions, 'later');
  const where = and(
    within(scope, decisions.accountId),
    eq(decisions.ruleId, ruleId),
    eq(decisions.carryOut, false),
    eq(decisions.byUser, false),
    eq(
      decisions.id,
      db
        .select({ id: max(later.id) })
        .from(later)
        .where(and(eq(later.accountId, decisions.accountId), eq(later.messageId, decisions.messageId))),
    ),
  );
  const [total] = await db.select({ n: count() }).from(decisions).where(where);
  const rows = await db
    .select({ accountId: decisions.accountId, messageId: decisions.messageId, headers: messages.headers, receivedAt: messages.receivedAt })
    .from(decisions)
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .where(where)
    .orderBy(desc(messages.receivedAt))
    .limit(MOST_WAITING);
  return {
    total: total?.n ?? 0,
    messages: rows.map((r) => {
      const { subject } = openEnvelope(db, r.accountId, r.messageId, r);
      return { accountId: r.accountId, messageId: r.messageId, subject, receivedAt: r.receivedAt };
    }),
  };
}
