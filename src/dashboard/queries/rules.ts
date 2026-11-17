import { actions, and, asc, decisions, eq, inArray, labels, max, rules, sql } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { ruleFilterStatus } from '../../store/filters.ts';
import { type Scope, within } from '../scope.ts';
import type { FilterChange, RuleSummary } from '../types.ts';
import { DAY_MS } from './decisions.ts';

/** Every rule in evaluation order, with its label, what it does, and how often and how recently it decided a message. */
export async function listRuleSummaries(db: Sql, scope: Scope): Promise<RuleSummary[]> {
  const filters = await ruleFilterStatus(db);
  const rows = await db
    .select({
      id: rules.id,
      accountId: rules.accountId,
      match: rules.match,
      except: rules.except,
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
        .where(eq(decisions.ruleId, rules.id))}`.mapWith(Number),
    })
    .from(rules)
    .leftJoin(labels, and(eq(labels.accountId, rules.accountId), eq(labels.id, sql`coalesce(${rules.labelId}, ${rules.whenLabel})`)))
    .where(within(scope, rules.accountId))
    .orderBy(asc(rules.accountId), asc(rules.position), asc(rules.id));
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    match: r.match,
    except: r.except,
    kind: r.labelId !== null ? 'label' : r.whenLabel !== null ? 'when-label' : 'action',
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
    filterId: r.filterId,
    filter: filters.get(r.id) ?? { state: 'none', possible: false, reason: null, plan: null, differs: [], checkedAt: null, last: null },
    createdAt: r.createdAt,
  }));
}

/** The Gmail filters sift wrote or took out in the last `days`, newest first. */
export async function listFilterChanges(db: Sql, scope: Scope, days: number, now: number): Promise<FilterChange[]> {
  const kept = new Set((await db.select({ id: rules.id }).from(rules).where(within(scope, rules.accountId))).map((r) => r.id));
  // All of them, not only the period's: one taken out is shown by what it matched, which only its writing records.
  const changes = await db
    .select({
      id: actions.id,
      accountId: actions.accountId,
      type: actions.type,
      status: actions.status,
      error: actions.error,
      at: actions.createdAt,
      payload: actions.payload,
    })
    .from(actions)
    .where(and(within(scope, actions.accountId), inArray(actions.type, ['filter', 'unfilter'])))
    .orderBy(asc(actions.id));
  const written = new Map<string, FilterChange['criteria']>();
  const listed: FilterChange[] = [];
  for (const { payload, type, ...change } of changes) {
    const { ruleId, criteria } = payload.filter!;
    if (type === 'filter' && criteria) written.set(ruleId, criteria);
    if (change.at >= now - days * DAY_MS)
      listed.push({ ...change, type: type as FilterChange['type'], ruleId: kept.has(ruleId) ? ruleId : null, criteria: written.get(ruleId) ?? {} });
  }
  return listed.toReversed();
}
