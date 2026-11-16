import { finishAction, insertPendingAction } from '../store/actions.ts';
import { filterVerdicts, getRuleFilter, listRuleFilters, setRuleFilter } from '../store/filters.ts';
import type { FilterPlan } from '../triage/filter.ts';
import type { ActionDeps } from './executor.ts';
import { type ExistingFilter, type FilterProposal, sameFilter, validateFilter } from './filters.ts';

/** Gmail's limit per account. */
const MAX_FILTERS = 1000;

/** Kept on the rule: what it asked for, to notice the rule changing, and what Gmail stored, to notice the filter changing. */
interface Written {
  plan: FilterPlan;
  got: ExistingFilter;
}

const clock = (deps: ActionDeps) => (deps.now ?? Date.now)();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const samePlan = (a: FilterPlan, b: FilterPlan) =>
  a.gmailLabel === b.gmailLabel &&
  a.archive === b.archive &&
  a.criteria.from === b.criteria.from &&
  a.criteria.to === b.criteria.to &&
  a.criteria.subject === b.criteria.subject;
const NONE = { filterId: null, state: null, written: null };

/**
 * Copy a rule to Gmail as a filter, replacing the one it already has. Throws, with a sentence for the
 * user, when the rule cannot be a filter or Gmail did not keep it. A filter the account already has that
 * does exactly this is taken over instead of duplicated, which Gmail would refuse.
 */
export async function writeRuleFilter(deps: ActionDeps, ruleId: string): Promise<void> {
  const row = getRuleFilter(deps.db, ruleId);
  if (!row) throw new Error('That rule no longer exists.');
  const verdict = filterVerdicts(deps.db, row.accountId, clock(deps)).get(ruleId);
  if (!verdict?.possible) throw new Error(verdict?.reason ?? 'That rule cannot be a Gmail filter.');
  if (row.filterId) await removeRuleFilter(deps, ruleId);

  const { plan } = verdict;
  const labelId = await deps.mailbox.ensureLabel(plan.gmailLabel);
  const filter: FilterProposal = { criteria: plan.criteria, action: { addLabelIds: [labelId], ...(plan.archive ? { removeLabelIds: ['INBOX'] } : {}) } };
  const problems = validateFilter(filter);
  if (problems.length > 0) throw new Error(`Refusing to create filter: ${problems.join('; ')}`);
  const before = await deps.mailbox.listFilters();
  const twin = before.find((f) => sameFilter(f, filter));
  if (!twin && before.length >= MAX_FILTERS) throw new Error('Gmail allows 1,000 filters and this account already has that many.');

  const actionId = insertPendingAction(
    deps.db,
    { accountId: row.accountId, messageId: null, type: 'filter', payload: { add: [], remove: [], filter: { ruleId, ...filter } }, originalLabels: [] },
    clock(deps),
  );
  let got: ExistingFilter | undefined;
  try {
    const id = twin?.id ?? (await deps.mailbox.createFilter(filter));
    got = (await deps.mailbox.listFilters()).find((f) => f.id === id);
  } catch (error) {
    // It may exist in Gmail all the same. Asking again finds it there and takes it over.
    finishAction(deps.db, actionId, 'unknown', null, message(error), clock(deps));
    throw error;
  }
  if (!got) {
    finishAction(deps.db, actionId, 'failed', null, 'the filter was not there when read back', clock(deps));
    throw new Error('Gmail did not keep the filter.');
  }
  finishAction(deps.db, actionId, 'done', null, null, clock(deps));
  setRuleFilter(deps.db, ruleId, { filterId: got.id, state: 'active', written: JSON.stringify({ plan, got } satisfies Written) }, clock(deps));
}

/** Take a rule's filter out of Gmail. Returns false if it had none. Throws if Gmail still has it afterwards. */
export async function removeRuleFilter(deps: ActionDeps, ruleId: string): Promise<boolean> {
  const row = getRuleFilter(deps.db, ruleId);
  if (!row) throw new Error('That rule no longer exists.');
  const { filterId } = row;
  if (!filterId) {
    setRuleFilter(deps.db, ruleId, NONE, clock(deps));
    return false;
  }
  const actionId = insertPendingAction(
    deps.db,
    { accountId: row.accountId, messageId: null, type: 'unfilter', payload: { add: [], remove: [], filter: { ruleId, id: filterId } }, originalLabels: [] },
    clock(deps),
  );
  let still: boolean;
  try {
    await deps.mailbox.deleteFilter(filterId);
    still = (await deps.mailbox.listFilters()).some((f) => f.id === filterId);
  } catch (error) {
    finishAction(deps.db, actionId, 'unknown', null, message(error), clock(deps));
    throw error;
  }
  if (still) {
    finishAction(deps.db, actionId, 'failed', null, 'the filter was still there when read back', clock(deps));
    throw new Error('Gmail still has the filter.');
  }
  finishAction(deps.db, actionId, 'done', null, null, clock(deps));
  setRuleFilter(deps.db, ruleId, NONE, clock(deps));
  return true;
}

export interface FilterCheck {
  /** Filters the user deleted in Gmail. */
  gone: number;
  /** Filters the user edited in Gmail. sift leaves them as they are. */
  changed: number;
  /** Filters that no longer did what their rule says. Replaced or removed when acting, only marked otherwise. */
  outdated: number;
}

/**
 * Compare the filters sift wrote with what Gmail holds now, and record on each rule what was found.
 * A filter whose rule has since changed would keep doing what the rule used to say, so when `act` is
 * set it is replaced, or removed if the rule can no longer be a filter. Counts are of what changed
 * since the last check. Null when the account has no such rules, in which case Gmail is not asked.
 */
export async function checkRuleFilters(deps: ActionDeps, accountId: string, act: boolean): Promise<FilterCheck | null> {
  const rows = listRuleFilters(deps.db, accountId);
  if (rows.length === 0) return null;
  const existing = await deps.mailbox.listFilters();
  const check: FilterCheck = { gone: 0, changed: 0, outdated: 0 };

  for (const row of rows) {
    const written = row.written === null ? null : (JSON.parse(row.written) as Written);
    const found = existing.find((f) => f.id === row.filterId);
    if (!found) {
      setRuleFilter(deps.db, row.ruleId, { ...NONE, state: 'gone' }, clock(deps));
      check.gone++;
      continue;
    }
    if (!written || !sameFilter(found, written.got)) {
      setRuleFilter(deps.db, row.ruleId, { ...row, state: 'changed' }, clock(deps));
      if (row.state !== 'changed') check.changed++;
      continue;
    }
    // Asked afresh each time: removing or replacing one filter can clear the way for another rule.
    const verdict = filterVerdicts(deps.db, accountId, clock(deps)).get(row.ruleId);
    if (verdict?.possible && samePlan(verdict.plan, written.plan)) {
      setRuleFilter(deps.db, row.ruleId, { ...row, state: 'active' }, clock(deps));
      continue;
    }
    if (row.state !== 'outdated') check.outdated++;
    if (!act) setRuleFilter(deps.db, row.ruleId, { ...row, state: 'outdated' }, clock(deps));
    else if (verdict?.possible) await writeRuleFilter(deps, row.ruleId);
    else {
      await removeRuleFilter(deps, row.ruleId);
      setRuleFilter(deps.db, row.ruleId, { ...NONE, state: 'outdated' }, clock(deps));
    }
  }
  return check;
}
