import type { ActionDeps } from '../actions/executor.ts';
import { type FilterCheck, checkRuleFilters, filterRetries, openFilterChanges, retryRuleFilters } from '../actions/rule-filters.ts';
import { filtersCheckedAt, listRuleFilters, markFiltersChecked } from '../store/filters.ts';
import type { Sql } from '../store/sql.ts';

/** Filters change rarely, and only by the user's hand in Gmail's settings. */
export const FILTER_CHECK_MINUTES = 15;

const lookedLately = async (db: Sql, accountId: string, now: number) => {
  const last = await filtersCheckedAt(db, accountId);
  return last !== null && now - last < FILTER_CHECK_MINUTES * 60_000;
};

/** Whether `checkFiltersWhenDue` would find anything to look at: a filter to check, a change to settle or to ask for again. */
export async function filtersDue(db: Sql, accountId: string, fix: boolean, now: number): Promise<boolean> {
  if (await lookedLately(db, accountId, now)) return false;
  return (
    (await listRuleFilters(db, accountId)).length > 0 ||
    (await openFilterChanges(db, accountId)).length > 0 ||
    (fix && (await filterRetries(db, accountId)).length > 0)
  );
}

/**
 * Look at the account's filters in Gmail if it has not been done lately, bringing outdated ones into line with their rules when
 * `fix` is set. Null when it was not due or there was nothing to look at.
 */
export async function checkFiltersWhenDue(deps: ActionDeps, accountId: string, fix: boolean): Promise<FilterCheck | null> {
  const now = (deps.now ?? Date.now)();
  if (await lookedLately(deps.db, accountId, now)) return null;
  if (fix) await retryRuleFilters(deps, accountId);
  const check = await checkRuleFilters(deps, accountId, fix);
  await markFiltersChecked(deps.db, accountId, now);
  return check;
}
