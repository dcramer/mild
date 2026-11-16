import type { Sql } from '../../store/sql.ts';
import { ruleFilterStatus } from '../../store/filters.ts';
import { type Scope, within } from '../scope.ts';
import type { RuleSummary } from '../types.ts';

/** Every rule in evaluation order, with its label, what it does, and how often and how recently it decided a message. */
export async function listRuleSummaries(db: Sql, scope: Scope): Promise<RuleSummary[]> {
  const filters = await ruleFilterStatus(db);
  const rows = await db.all<{
    id: string;
    account_id: string;
    match_json: string;
    except_json: string;
    label_id: string | null;
    when_label: string | null;
    label_name: string | null;
    override: string | null;
    label_does: string | null;
    mark_read: number | null;
    unsubscribe: number | null;
    condition: string | null;
    source: string;
    hits: number;
    filter_id: string | null;
    created_at: number;
    last_hit_at: number | null;
  }>(`SELECT r.id, r.account_id, r.match_json, r.except_json, r.label_id, r.when_label, l.name AS label_name, r.disposition AS override, CASE WHEN l.block = 1 THEN 'block' ELSE l.disposition END AS label_does,
              (r.mark_read = 1 OR l.mark_read = 1) AS mark_read, (r.subscription = 'unsubscribe' OR l.unsubscribe = 1) AS unsubscribe,
              r.condition, r.source, r.hits, r.filter_id, r.created_at,
              (SELECT max(decided_at) FROM decisions d WHERE d.rule_id = r.id) AS last_hit_at
       FROM rules r LEFT JOIN labels l ON l.account_id = r.account_id AND l.id = coalesce(r.label_id, r.when_label)
       WHERE ${within(scope, 'r.account_id')}
       ORDER BY r.account_id, r.position, r.id`);
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    match: JSON.parse(r.match_json) as Record<string, string>,
    except: JSON.parse(r.except_json) as Record<string, string>[],
    kind: r.label_id !== null ? 'label' : r.when_label !== null ? 'when-label' : 'action',
    labelId: r.label_id,
    whenLabel: r.when_label,
    labelName: r.label_name,
    labelGone: (r.label_id ?? r.when_label) !== null && r.label_name === null,
    override: r.override,
    disposition: (r.label_id ?? r.when_label) !== null && r.label_name === null ? null : (r.override ?? r.label_does),
    markRead: r.mark_read === 1,
    unsubscribe: r.unsubscribe === 1,
    when: r.condition,
    source: r.source,
    hits: r.hits,
    lastHitAt: r.last_hit_at,
    filterId: r.filter_id,
    filter: filters.get(r.id) ?? { state: 'none', possible: false, reason: null, differs: [], checkedAt: null },
    createdAt: r.created_at,
  }));
}
