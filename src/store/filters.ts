import type { Sql } from './sql.ts';
import { type FilterVerdict, filterFor } from '../triage/filter.ts';
import { listAccounts } from './accounts.ts';
import { listLabels } from './labels.ts';
import { listRules } from './rules.ts';

/**
 * What became of the Gmail filter sift wrote for a rule. `active`: still as written. `changed`: edited in
 * Gmail. `gone`: deleted in Gmail. `outdated`: the rule no longer says what the filter does.
 */
export type FilterState = 'active' | 'changed' | 'gone' | 'outdated';

export interface RuleFilterRow {
  ruleId: string;
  accountId: string;
  /** The filter in Gmail, while there is one. */
  filterId: string | null;
  state: FilterState | null;
  /** JSON kept by `src/actions/rule-filters.ts`: what the rule asked for and what Gmail stored. */
  written: string | null;
  checkedAt: number | null;
}

interface Row {
  id: string;
  account_id: string;
  filter_id: string | null;
  filter_state: FilterState | null;
  filter_json: string | null;
  filter_checked_at: number | null;
}

const COLUMNS = 'id, account_id, filter_id, filter_state, filter_json, filter_checked_at';
const fromRow = (r: Row): RuleFilterRow => ({
  ruleId: r.id,
  accountId: r.account_id,
  filterId: r.filter_id,
  state: r.filter_state,
  written: r.filter_json,
  checkedAt: r.filter_checked_at,
});

export async function getRuleFilter(db: Sql, ruleId: string): Promise<RuleFilterRow | null> {
  const row = await db.get<Row>(`SELECT ${COLUMNS} FROM rules WHERE id = ?`, ruleId);
  return row ? fromRow(row) : null;
}

/** The account's rules that have a filter in Gmail, as far as sift knows. */
export async function listRuleFilters(db: Sql, accountId: string): Promise<RuleFilterRow[]> {
  const rows = await db.all(`SELECT ${COLUMNS} FROM rules WHERE account_id = ? AND filter_id IS NOT NULL ORDER BY position, id`, accountId);
  return (rows as unknown as Row[]).map(fromRow);
}

export async function setRuleFilter(
  db: Sql,
  ruleId: string,
  value: { filterId: string | null; state: FilterState | null; written: string | null },
  now: number,
): Promise<void> {
  await db.run(
    'UPDATE rules SET filter_id = ?, filter_state = ?, filter_json = ?, filter_checked_at = ? WHERE id = ?',
    value.filterId,
    value.state,
    value.written,
    now,
    ruleId,
  );
}

/** For each of the account's rules, whether it can be a Gmail filter as things stand. */
export async function filterVerdicts(db: Sql, accountId: string, now: number = Date.now()): Promise<Map<string, FilterVerdict>> {
  const rules = await listRules(db, accountId);
  const labels = await listLabels(db, accountId, now);
  return new Map(rules.map((rule) => [rule.id, filterFor(rule, labels, rules)]));
}

export async function filtersCheckedAt(db: Sql, accountId: string): Promise<number | null> {
  return (await db.get<{ at: number | null }>('SELECT filters_checked_at AS at FROM mailboxes WHERE id = ?', accountId))?.at ?? null;
}

export async function markFiltersChecked(db: Sql, accountId: string, now: number): Promise<void> {
  await db.run('UPDATE mailboxes SET filters_checked_at = ? WHERE id = ?', now, accountId);
}

export interface RuleFilterStatus {
  state: 'none' | FilterState;
  possible: boolean;
  reason: string | null;
  differs: string[];
  checkedAt: number | null;
}

/** Every rule's standing as a Gmail filter, by rule id, for the dashboard. */
export async function ruleFilterStatus(db: Sql, now: number = Date.now()): Promise<Map<string, RuleFilterStatus>> {
  const status = new Map<string, RuleFilterStatus>();
  for (const account of await listAccounts(db)) {
    for (const [ruleId, verdict] of await filterVerdicts(db, account.id, now)) {
      const row = (await db.get<{ filter_state: FilterState | null; filter_checked_at: number | null }>(
        'SELECT filter_state, filter_checked_at FROM rules WHERE id = ?',
        ruleId,
      ))!;
      status.set(ruleId, {
        state: row.filter_state ?? 'none',
        possible: verdict.possible,
        reason: verdict.possible ? null : verdict.reason,
        differs: verdict.possible ? verdict.differs : [],
        checkedAt: row.filter_checked_at,
      });
    }
  }
  return status;
}
