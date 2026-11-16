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
