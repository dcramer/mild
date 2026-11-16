import { and, asc, decisions, eq, labels, max, rules, sql } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { ruleFilterStatus } from '../../store/filters.ts';
import { type Scope, within } from '../scope.ts';
import type { RuleSummary } from '../types.ts';

/** Every rule in evaluation order, with its label, what it does, and how often and how recently it decided a message. */
export async function listRuleSummaries(db: Sql, scope: Scope): Promise<RuleSummary[]> {
  const filters = await ruleFilterStatus(db);
  const rows = await db
    .select({
      id: rules.id,
      accountId: rules.accountId,
      matchJson: rules.matchJson,
      exceptJson: rules.exceptJson,
      labelId: rules.labelId,
      whenLabel: rules.whenLabel,
      labelName: labels.name,
      override: rules.disposition,
      labelDoes: sql<string | null>`CASE WHEN ${labels.block} = 1 THEN 'block' ELSE ${labels.disposition} END`,
      markRead: sql<number | null>`(${rules.markRead} = 1 OR ${labels.markRead} = 1)::integer`,
      unsubscribe: sql<number | null>`(${rules.subscription} = 'unsubscribe' OR ${labels.unsubscribe} = 1)::integer`,
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
    match: JSON.parse(r.matchJson) as Record<string, string>,
    except: JSON.parse(r.exceptJson) as Record<string, string>[],
    kind: r.labelId !== null ? 'label' : r.whenLabel !== null ? 'when-label' : 'action',
    labelId: r.labelId,
    whenLabel: r.whenLabel,
    labelName: r.labelName,
    labelGone: (r.labelId ?? r.whenLabel) !== null && r.labelName === null,
    override: r.override,
    disposition: (r.labelId ?? r.whenLabel) !== null && r.labelName === null ? null : (r.override ?? r.labelDoes),
    markRead: r.markRead === 1,
    unsubscribe: r.unsubscribe === 1,
    when: r.condition,
    source: r.source,
    hits: r.hits,
    lastHitAt: r.lastHitAt,
    filterId: r.filterId,
    filter: filters.get(r.id) ?? { state: 'none', possible: false, reason: null, differs: [], checkedAt: null },
    createdAt: r.createdAt,
  }));
}
