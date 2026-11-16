import type { ActionDeps } from '../actions/executor.ts';
import { type FilterCheck, checkRuleFilters } from '../actions/rule-filters.ts';
import { filtersCheckedAt, markFiltersChecked } from '../store/filters.ts';

/** Filters change rarely, and only by the user's hand in Gmail's settings. */
export const FILTER_CHECK_MINUTES = 15;

/** Look at the account's filters in Gmail if it has not been done lately. Null when it was not due or there was nothing to look at. */
export async function checkFiltersWhenDue(deps: ActionDeps, accountId: string, act: boolean): Promise<FilterCheck | null> {
  const now = (deps.now ?? Date.now)();
  const last = filtersCheckedAt(deps.db, accountId);
  if (last !== null && now - last < FILTER_CHECK_MINUTES * 60_000) return null;
  const check = await checkRuleFilters(deps, accountId, act);
  markFiltersChecked(deps.db, accountId, now);
  return check;
}
