import { type ActionPayload, finishAction, insertPendingAction } from '../store/actions.ts';
import { filterVerdicts, getRuleFilter, listRuleFilters, setRuleFilter } from '../store/filters.ts';
import { actions, and, asc, eq, inArray } from '../store/query.ts';
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
  const found = await getRuleFilter(deps.db, ruleId);
  if (!found) throw new Error('That rule no longer exists.');
  await settleRuleFilters(deps, found.accountId);
  const row = (await getRuleFilter(deps.db, ruleId))!;
  const verdict = (await filterVerdicts(deps.db, row.accountId)).get(ruleId);
  if (!verdict?.possible) throw new Error(verdict?.reason ?? 'That rule cannot be a Gmail filter.');
  if (row.filterId) await removeRuleFilter(deps, ruleId);

  const { plan } = verdict;
  const filter = await proposal(deps, plan);
  const problems = validateFilter({ ...filter, ...(row.match.facts ? { facts: row.match.facts } : {}) });
  if (problems.length > 0) throw new Error(`Refusing to create filter: ${problems.join('; ')}`);
  const before = await deps.mailbox.listFilters();
  const twin = before.find((f) => sameFilter(f, filter));
  if (!twin && before.length >= MAX_FILTERS) throw new Error('Gmail allows 1,000 filters and this account already has that many.');

  const actionId = await insertPendingAction(
    deps.db,
    { accountId: row.accountId, messageId: null, type: 'filter', payload: { add: [], remove: [], filter: { ruleId, ...filter } }, originalLabels: [] },
    clock(deps),
  );
  let got: ExistingFilter | undefined;
  try {
    const id = twin?.id ?? (await deps.mailbox.createFilter(filter));
    got = (await deps.mailbox.listFilters()).find((f) => f.id === id);
  } catch (error) {
    // It may exist in Gmail all the same: settleRuleFilters finds it there.
    await finishAction(deps.db, actionId, 'unknown', null, message(error), clock(deps));
    throw error;
  }
  if (!got) {
    await finishAction(deps.db, actionId, 'failed', null, 'the filter was not there when read back', clock(deps));
    throw new Error('Gmail did not keep the filter.');
  }
  await finishAction(deps.db, actionId, 'done', null, null, clock(deps));
  await setRuleFilter(deps.db, ruleId, { filterId: got.id, state: 'active', written: { plan, got } satisfies Written }, clock(deps));
}

/** Take a rule's filter out of Gmail. Returns false if it had none. Throws if Gmail still has it afterwards. */
export async function removeRuleFilter(deps: ActionDeps, ruleId: string): Promise<boolean> {
  const found = await getRuleFilter(deps.db, ruleId);
  if (!found) throw new Error('That rule no longer exists.');
  await settleRuleFilters(deps, found.accountId);
  const { accountId, filterId } = (await getRuleFilter(deps.db, ruleId))!;
  if (filterId) await takeOut(deps, accountId, ruleId, filterId);
  await setRuleFilter(deps.db, ruleId, NONE, clock(deps));
  return filterId !== null;
}

async function proposal(deps: ActionDeps, plan: FilterPlan): Promise<FilterProposal> {
  const add = plan.gmailLabel === undefined ? [] : [await deps.mailbox.ensureLabel(plan.gmailLabel)];
  return {
    criteria: plan.criteria,
    action: { ...(add.length > 0 ? { addLabelIds: add } : {}), ...(plan.archive ? { removeLabelIds: ['INBOX'] } : {}) },
  };
}

async function takeOut(deps: ActionDeps, accountId: string, ruleId: string, filterId: string): Promise<void> {
  const actionId = await insertPendingAction(
    deps.db,
    { accountId, messageId: null, type: 'unfilter', payload: { add: [], remove: [], filter: { ruleId, id: filterId } }, originalLabels: [] },
    clock(deps),
  );
  let still: boolean;
  try {
    await deps.mailbox.deleteFilter(filterId);
    still = (await deps.mailbox.listFilters()).some((f) => f.id === filterId);
  } catch (error) {
    await finishAction(deps.db, actionId, 'unknown', null, message(error), clock(deps));
    throw error;
  }
  if (still) {
    await finishAction(deps.db, actionId, 'failed', null, 'the filter was still there when read back', clock(deps));
    throw new Error('Gmail still has the filter.');
  }
  await finishAction(deps.db, actionId, 'done', null, null, clock(deps));
}

/**
 * Settle the account's filter changes that were never read back (Gmail errored after the call, or sift
 * stopped), by finding them in Gmail. A filter that landed goes on its rule if the rule has none and still
 * asks for exactly it; otherwise it is taken out, since a filter with no rule keeps acting on mail with
 * nothing in sift to show or remove it. An action stays open until that is done, so it is tried again.
 */
async function settleRuleFilters(deps: ActionDeps, accountId: string): Promise<void> {
  const open = await deps.db
    .select({ id: actions.id, type: actions.type, payload: actions.payload })
    .from(actions)
    .where(and(eq(actions.accountId, accountId), inArray(actions.type, ['filter', 'unfilter']), inArray(actions.status, ['pending', 'unknown'])))
    .orderBy(asc(actions.id));
  if (open.length === 0) return;
  const existing = await deps.mailbox.listFilters();
  for (const { id, type, payload } of open as { id: number; type: 'filter' | 'unfilter'; payload: ActionPayload }[]) {
    const { ruleId, id: filterId, criteria = {}, action = {} } = payload.filter!;
    const rule = await getRuleFilter(deps.db, ruleId);
    if (type === 'unfilter') {
      if (existing.some((f) => f.id === filterId)) {
        await finishAction(deps.db, id, 'failed', null, 'the filter was still there when read back', clock(deps));
        continue;
      }
      if (rule?.filterId === filterId) await setRuleFilter(deps.db, ruleId, NONE, clock(deps));
      await finishAction(deps.db, id, 'done', null, null, clock(deps));
      continue;
    }
    const landed = existing.find((f) => sameFilter(f, { criteria, action }));
    if (!landed) {
      await finishAction(deps.db, id, 'failed', null, 'the filter was not there when read back', clock(deps));
      continue;
    }
    const owned = (await listRuleFilters(deps.db, accountId)).some((r) => r.filterId === landed.id);
    if (!owned) {
      const verdict = rule && !rule.filterId ? (await filterVerdicts(deps.db, accountId)).get(ruleId) : undefined;
      if (verdict?.possible && sameFilter(landed, await proposal(deps, verdict.plan)))
        await setRuleFilter(
          deps.db,
          ruleId,
          { filterId: landed.id, state: 'active', written: { plan: verdict.plan, got: landed } satisfies Written },
          clock(deps),
        );
      else await takeOut(deps, accountId, ruleId, landed.id);
    }
    await finishAction(deps.db, id, 'done', null, null, clock(deps));
  }
}

export interface FilterCheck {
  /** Filters the user deleted in Gmail. */
  gone: number;
  /** Filters the user edited in Gmail. sift leaves them as they are. */
  changed: number;
  /** Filters that no longer did what their rule says. Replaced or removed when fixing, only marked otherwise. */
  outdated: number;
}

/**
 * Compare the filters sift wrote with what Gmail holds now, and record on each rule what was found.
 * A filter whose rule has since changed would keep doing what the rule used to say, so when `fix` is
 * set it is replaced, or removed if the rule can no longer be a filter. Counts are of what changed
 * since the last check. Null when the account has no such rules, in which case Gmail is asked only if a
 * change to its filters was never read back.
 */
export async function checkRuleFilters(deps: ActionDeps, accountId: string, fix: boolean): Promise<FilterCheck | null> {
  await settleRuleFilters(deps, accountId);
  const rows = await listRuleFilters(deps.db, accountId);
  if (rows.length === 0) return null;
  const existing = await deps.mailbox.listFilters();
  const check: FilterCheck = { gone: 0, changed: 0, outdated: 0 };

  for (const row of rows) {
    const written = row.written as Written | null;
    const found = existing.find((f) => f.id === row.filterId);
    if (!found) {
      await setRuleFilter(deps.db, row.ruleId, { ...NONE, state: 'gone' }, clock(deps));
      check.gone++;
      continue;
    }
    if (!written || !sameFilter(found, written.got)) {
      await setRuleFilter(deps.db, row.ruleId, { ...row, state: 'changed' }, clock(deps));
      if (row.state !== 'changed') check.changed++;
      continue;
    }
    // Asked afresh each time: removing or replacing one filter can clear the way for another rule.
    const verdict = (await filterVerdicts(deps.db, accountId)).get(row.ruleId);
    if (verdict?.possible && samePlan(verdict.plan, written.plan)) {
      await setRuleFilter(deps.db, row.ruleId, { ...row, state: 'active' }, clock(deps));
      continue;
    }
    if (row.state !== 'outdated') check.outdated++;
    if (!fix) await setRuleFilter(deps.db, row.ruleId, { ...row, state: 'outdated' }, clock(deps));
    else if (verdict?.possible) await writeRuleFilter(deps, row.ruleId);
    else {
      await removeRuleFilter(deps, row.ruleId);
      await setRuleFilter(deps.db, row.ruleId, { ...NONE, state: 'outdated' }, clock(deps));
    }
  }
  return check;
}
