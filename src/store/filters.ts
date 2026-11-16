import type { DatabaseSync } from 'node:sqlite';
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

export function getRuleFilter(db: DatabaseSync, ruleId: string): RuleFilterRow | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM rules WHERE id = ?`).get(ruleId) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** The account's rules that have a filter in Gmail, as far as sift knows. */
export function listRuleFilters(db: DatabaseSync, accountId: string): RuleFilterRow[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM rules WHERE account_id = ? AND filter_id IS NOT NULL ORDER BY position, id`).all(accountId);
  return (rows as unknown as Row[]).map(fromRow);
}

export function setRuleFilter(
  db: DatabaseSync,
  ruleId: string,
  value: { filterId: string | null; state: FilterState | null; written: string | null },
  now: number,
): void {
  db.prepare('UPDATE rules SET filter_id = ?, filter_state = ?, filter_json = ?, filter_checked_at = ? WHERE id = ?').run(
    value.filterId,
    value.state,
    value.written,
    now,
    ruleId,
  );
}

/** For each of the account's rules, whether it can be a Gmail filter as things stand. */
export function filterVerdicts(db: DatabaseSync, accountId: string, now: number = Date.now()): Map<string, FilterVerdict> {
  const rules = listRules(db, accountId);
  const labels = listLabels(db, accountId, now);
  return new Map(rules.map((rule) => [rule.id, filterFor(rule, labels, rules)]));
}

export function filtersCheckedAt(db: DatabaseSync, accountId: string): number | null {
  return (db.prepare('SELECT filters_checked_at AS at FROM accounts WHERE id = ?').get(accountId) as { at: number | null } | undefined)?.at ?? null;
}

export function markFiltersChecked(db: DatabaseSync, accountId: string, now: number): void {
  db.prepare('UPDATE accounts SET filters_checked_at = ? WHERE id = ?').run(now, accountId);
}

export interface RuleFilterStatus {
  state: 'none' | FilterState;
  possible: boolean;
  reason: string | null;
  differs: string[];
  checkedAt: number | null;
}

/** Every rule's standing as a Gmail filter, by rule id, for the dashboard. */
export function ruleFilterStatus(db: DatabaseSync, now: number = Date.now()): Map<string, RuleFilterStatus> {
  const status = new Map<string, RuleFilterStatus>();
  const stored = db.prepare('SELECT filter_state, filter_checked_at FROM rules WHERE id = ?');
  for (const account of listAccounts(db)) {
    for (const [ruleId, verdict] of filterVerdicts(db, account.id, now)) {
      const row = stored.get(ruleId) as { filter_state: FilterState | null; filter_checked_at: number | null };
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
