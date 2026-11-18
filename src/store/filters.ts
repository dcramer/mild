import { type FILTER_STATES, actions, and, asc, eq, inArray, isNotNull, mailboxes, ruleFilters, rules as ruleRows } from './query.ts';
import type { Sql } from './sql.ts';
import { openJson, ruleName, sealJson } from './content.ts';
import { openPayload } from './actions.ts';
import { type FilterPlan, type FilterVerdict, filterFor } from '../triage/filter.ts';
import type { RuleMatch } from '../triage/stages/rules.ts';
import { listLabels } from './labels.ts';
import { listRules } from './rules.ts';

/** What became of the Gmail filter sift wrote for a rule. */
type FilterState = (typeof FILTER_STATES)[number];

interface RuleFilterRow {
  ruleId: string;
  /** The mailbox whose Gmail holds the filter: a rule is the person's, and each mailbox has its own filters. */
  accountId: string;
  match: RuleMatch;
  /** The filter in Gmail, while there is one. */
  filterId: string | null;
  state: FilterState | null;
  /** Kept by `src/actions/rule-filters.ts`: what the rule asked for and what Gmail stored. */
  written: Record<string, unknown> | null;
  checkedAt: number | null;
}

const COLUMNS = {
  ruleId: ruleRows.id,
  match: ruleRows.match,
  filterId: ruleFilters.filterId,
  state: ruleFilters.state,
  written: ruleFilters.written,
  checkedAt: ruleFilters.checkedAt,
};

const opened = (
  db: Sql,
  accountId: string,
  { match, written, ...r }: { ruleId: string; match: string; written: string | null } & Omit<RuleFilterRow, 'accountId' | 'match' | 'written'>,
): RuleFilterRow => ({
  ...r,
  accountId,
  match: openJson<RuleMatch>(db, ruleName(db, r.ruleId, 'match'), match),
  written: written === null ? null : openJson<Record<string, unknown>>(db, ruleName(db, r.ruleId, 'filter'), written),
});

const inMailbox = (accountId: string) => and(eq(ruleFilters.ruleId, ruleRows.id), eq(ruleFilters.accountId, accountId));

/** A rule's filter in one mailbox; filterId and state are null when it has none there. Null when there is no such rule. */
export async function getRuleFilter(db: Sql, ruleId: string, accountId: string): Promise<RuleFilterRow | null> {
  const [row] = await db.select(COLUMNS).from(ruleRows).leftJoin(ruleFilters, inMailbox(accountId)).where(eq(ruleRows.id, ruleId));
  return row ? opened(db, accountId, row) : null;
}

/** The rules that have a filter in this mailbox's Gmail, as far as sift knows. */
export async function listRuleFilters(db: Sql, accountId: string): Promise<RuleFilterRow[]> {
  const rows = await db
    .select(COLUMNS)
    .from(ruleRows)
    .innerJoin(ruleFilters, inMailbox(accountId))
    .where(isNotNull(ruleFilters.filterId))
    .orderBy(asc(ruleRows.position), asc(ruleRows.id));
  return rows.map((r) => opened(db, accountId, r));
}

export async function setRuleFilter(
  db: Sql,
  ruleId: string,
  accountId: string,
  value: { filterId: string | null; state: FilterState | null; written: Record<string, unknown> | null },
  now: number,
): Promise<void> {
  if (value.filterId === null && value.state === null) {
    await db.delete(ruleFilters).where(and(eq(ruleFilters.ruleId, ruleId), eq(ruleFilters.accountId, accountId)));
    return;
  }
  const row = {
    filterId: value.filterId,
    state: value.state,
    written: value.written === null ? null : sealJson(db, ruleName(db, ruleId, 'filter'), value.written),
    checkedAt: now,
  };
  await db
    .insert(ruleFilters)
    .values({ ruleId, accountId, ...row })
    .onConflictDoUpdate({ target: [ruleFilters.userId, ruleFilters.ruleId, ruleFilters.accountId], set: row });
}

/** For each of the person's rules, whether it can be a Gmail filter as things stand. */
export async function filterVerdicts(db: Sql): Promise<Map<string, FilterVerdict>> {
  const rules = await listRules(db);
  const labels = await listLabels(db);
  return new Map(rules.map((rule) => [rule.id, filterFor(rule, labels, rules)]));
}

export async function filtersCheckedAt(db: Sql, accountId: string): Promise<number | null> {
  const [row] = await db.select({ at: mailboxes.filtersCheckedAt }).from(mailboxes).where(eq(mailboxes.id, accountId));
  return row?.at ?? null;
}

export async function markFiltersChecked(db: Sql, accountId: string, now: number): Promise<void> {
  await db.update(mailboxes).set({ filtersCheckedAt: now }).where(eq(mailboxes.id, accountId));
}

interface RuleFilterStatus {
  state: 'none' | FilterState;
  possible: boolean;
  reason: string | null;
  plan: FilterPlan | null;
  differs: string[];
  checkedAt: number | null;
  history: { type: 'filter' | 'unfilter'; status: string; error: string | null; at: number }[];
}

/** Each rule's filter changes, oldest first, by rule id: every account's, or one account's. */
export async function filterHistory(db: Sql, accountId?: string): Promise<Map<string, RuleFilterStatus['history']>> {
  const history = new Map<string, RuleFilterStatus['history']>();
  const changes = await db
    .select({ accountId: actions.accountId, type: actions.type, status: actions.status, error: actions.error, at: actions.createdAt, payload: actions.payload })
    .from(actions)
    .where(and(inArray(actions.type, ['filter', 'unfilter']), accountId === undefined ? undefined : eq(actions.accountId, accountId)))
    .orderBy(asc(actions.id));
  for (const { accountId: owner, payload, ...change } of changes) {
    const { ruleId } = openPayload(db, owner, payload).filter!;
    history.set(ruleId, [...(history.get(ruleId) ?? []), change as RuleFilterStatus['history'][number]]);
  }
  return history;
}

/** What needs the reader most, when one rule's filters in several mailboxes differ. */
const WORST: readonly FilterState[] = ['changed', 'outdated', 'gone', 'active'];

/**
 * Every rule's standing as a Gmail filter, by rule id, for the dashboard: its filter in any mailbox (`filterId`),
 * and of its mailboxes' states the one that most needs the reader.
 */
export async function ruleFilterStatus(db: Sql): Promise<Map<string, RuleFilterStatus & { filterId: string | null }>> {
  const history = await filterHistory(db);
  const rows = await db
    .select({ ruleId: ruleFilters.ruleId, filterId: ruleFilters.filterId, state: ruleFilters.state, checkedAt: ruleFilters.checkedAt })
    .from(ruleFilters);
  const status = new Map<string, RuleFilterStatus & { filterId: string | null }>();
  for (const [ruleId, verdict] of await filterVerdicts(db)) {
    const mine = rows.filter((r) => r.ruleId === ruleId);
    const state = WORST.find((s) => mine.some((r) => r.state === s)) ?? 'none';
    status.set(ruleId, {
      state,
      filterId: mine.find((r) => r.filterId !== null)?.filterId ?? null,
      possible: verdict.possible,
      reason: verdict.possible ? null : verdict.reason,
      plan: verdict.possible ? verdict.plan : null,
      differs: verdict.possible ? verdict.differs : [],
      checkedAt: mine.reduce<number | null>((at, r) => (at === null || r.checkedAt > at ? r.checkedAt : at), null),
      history: history.get(ruleId) ?? [],
    });
  }
  return status;
}
