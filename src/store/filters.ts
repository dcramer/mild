import { and, asc, eq, isNotNull, mailboxes, rules as ruleRows } from './query.ts';
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

const COLUMNS = {
  ruleId: ruleRows.id,
  accountId: ruleRows.accountId,
  filterId: ruleRows.filterId,
  state: ruleRows.filterState,
  written: ruleRows.filterJson,
  checkedAt: ruleRows.filterCheckedAt,
};

export async function getRuleFilter(db: Sql, ruleId: string): Promise<RuleFilterRow | null> {
  const [row] = await db.select(COLUMNS).from(ruleRows).where(eq(ruleRows.id, ruleId));
  return (row as RuleFilterRow | undefined) ?? null;
}

/** The account's rules that have a filter in Gmail, as far as sift knows. */
export async function listRuleFilters(db: Sql, accountId: string): Promise<RuleFilterRow[]> {
  return (await db
    .select(COLUMNS)
    .from(ruleRows)
    .where(and(eq(ruleRows.accountId, accountId), isNotNull(ruleRows.filterId)))
    .orderBy(asc(ruleRows.position), asc(ruleRows.id))) as RuleFilterRow[];
}

export async function setRuleFilter(
  db: Sql,
  ruleId: string,
  value: { filterId: string | null; state: FilterState | null; written: string | null },
  now: number,
): Promise<void> {
  await db
    .update(ruleRows)
    .set({ filterId: value.filterId, filterState: value.state, filterJson: value.written, filterCheckedAt: now })
    .where(eq(ruleRows.id, ruleId));
}

/** For each of the account's rules, whether it can be a Gmail filter as things stand. */
export async function filterVerdicts(db: Sql, accountId: string, now: number = Date.now()): Promise<Map<string, FilterVerdict>> {
  const rules = await listRules(db, accountId);
  const labels = await listLabels(db, accountId, now);
  return new Map(rules.map((rule) => [rule.id, filterFor(rule, labels, rules)]));
}

export async function filtersCheckedAt(db: Sql, accountId: string): Promise<number | null> {
  const [row] = await db.select({ at: mailboxes.filtersCheckedAt }).from(mailboxes).where(eq(mailboxes.id, accountId));
  return row?.at ?? null;
}

export async function markFiltersChecked(db: Sql, accountId: string, now: number): Promise<void> {
  await db.update(mailboxes).set({ filtersCheckedAt: now }).where(eq(mailboxes.id, accountId));
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
      const [row] = (await db.select({ state: ruleRows.filterState, checkedAt: ruleRows.filterCheckedAt }).from(ruleRows).where(eq(ruleRows.id, ruleId))) as [
        { state: FilterState | null; checkedAt: number | null },
      ];
      status.set(ruleId, {
        state: row.state ?? 'none',
        possible: verdict.possible,
        reason: verdict.possible ? null : verdict.reason,
        differs: verdict.possible ? verdict.differs : [],
        checkedAt: row.checkedAt,
      });
    }
  }
  return status;
}
