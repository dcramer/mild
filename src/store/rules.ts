import { randomBytes } from 'node:crypto';
import { type RULE_SOURCES, and, asc, eq, proposals, rules, sql } from './query.ts';
import type { Sql } from './sql.ts';
import { type Rule, type RuleMatch, asksFacts } from '../triage/stages/rules.ts';
import { listLabels } from './labels.ts';

/** `user`: the user wrote it. `correction`: it came from the user correcting sift. `learned`: sift made it when it blocked the sender. */
type RuleSource = (typeof RULE_SOURCES)[number];

interface StoredRule extends Rule {
  source: RuleSource;
  hits: number;
}

/** An account's rules in evaluation order. */
export async function listRules(db: Sql, accountId: string): Promise<StoredRule[]> {
  const rows = await db
    .select({
      id: rules.id,
      match: rules.match,
      except: rules.except,
      labelId: rules.labelId,
      whenLabel: rules.whenLabel,
      disposition: rules.disposition,
      subscription: rules.subscription,
      markRead: rules.markRead,
      condition: rules.condition,
      source: rules.source,
      hits: rules.hits,
    })
    .from(rules)
    .where(eq(rules.accountId, accountId))
    .orderBy(asc(rules.position), asc(rules.id));
  return rows.map((r) => ({
    id: r.id,
    match: r.match,
    ...(r.except.length > 0 ? { except: r.except } : {}),
    ...(r.labelId ? { labelId: r.labelId } : {}),
    ...(r.whenLabel ? { whenLabel: r.whenLabel } : {}),
    ...(r.disposition ? { disposition: r.disposition } : {}),
    subscription: r.subscription,
    ...(r.markRead ? { markRead: true } : {}),
    ...(r.condition ? { when: r.condition } : {}),
    ...(r.source === 'learned' ? { learned: true } : {}),
    source: r.source,
    hits: r.hits,
  }));
}

/** What a rule says, apart from its conditions. */
export type RuleSays = Pick<Rule, 'labelId' | 'whenLabel' | 'disposition' | 'subscription' | 'markRead' | 'when'>;

/** Throws, with a sentence for the user, unless `rule` says something sift can act on with the account's labels. */
async function check(db: Sql, accountId: string, rule: RuleSays): Promise<void> {
  if (rule.labelId === undefined && rule.whenLabel === undefined && rule.disposition === undefined)
    throw new Error('A rule needs a label, an action, or both.');
  if (rule.labelId !== undefined && rule.whenLabel !== undefined) throw new Error('A rule either says what mail is or waits for a label, not both.');
  if (rule.when?.trim() && rule.labelId === undefined) throw new Error('A condition in your own words needs a label for the mail it describes.');
  const named = rule.labelId ?? rule.whenLabel;
  if (named !== undefined && !(await listLabels(db, accountId)).some((l) => l.id === named)) throw new Error(`There is no label "${named}".`);
}

/** Append a rule after the account's existing ones. Returns its id. Throws if it has no condition, says nothing, or names no label of the account's. */
export async function addRule(db: Sql, accountId: string, rule: Omit<Rule, 'id' | 'learned'>, source: RuleSource, now: number = Date.now()): Promise<string> {
  const { facts: _facts, ...named } = rule.match;
  if (Object.values(named).every((v) => v === undefined || v === '') && !asksFacts(rule.match)) throw new Error('A rule needs at least one condition.');
  await check(db, accountId, rule);
  const id = `r-${randomBytes(4).toString('hex')}`;
  const [{ next }] = (await db
    .select({ next: sql<number>`coalesce(max(${rules.position}), 0) + 1`.mapWith(Number) })
    .from(rules)
    .where(eq(rules.accountId, accountId))) as [{ next: number }];
  await db.insert(rules).values({
    id,
    accountId,
    position: next,
    match: rule.match,
    except: rule.except ?? [],
    labelId: rule.labelId ?? null,
    whenLabel: rule.whenLabel ?? null,
    disposition: rule.disposition ?? null,
    subscription: rule.subscription ?? 'preserve',
    markRead: rule.markRead ?? false,
    condition: rule.when?.trim() || null,
    source,
    createdAt: now,
  });
  return id;
}

/** Returns false if there was no such rule. Past decisions keep the rule id as history. */
export async function removeRule(db: Sql, id: string): Promise<boolean> {
  return (await db.delete(rules).where(eq(rules.id, id)).returning({ id: rules.id })).length > 0;
}

export async function countRuleHit(db: Sql, id: string): Promise<void> {
  await db
    .update(rules)
    .set({ hits: sql`${rules.hits} + 1` })
    .where(eq(rules.id, id));
}

/**
 * The rule with exactly these conditions and no exceptions, if there is one. A sender can have one rule
 * for all their mail and one for each label it might be, so `whenLabel` says which is meant: null for the
 * rule that waits for no label.
 */
async function ruleMatching(
  db: Sql,
  accountId: string,
  match: RuleMatch,
  whenLabel: string | null = null,
): Promise<{ id: string; source: RuleSource } | undefined> {
  const [row] = await db
    .select({ id: rules.id, source: rules.source })
    .from(rules)
    .where(and(eq(rules.accountId, accountId), eq(rules.match, match), eq(rules.except, []), sql`${rules.whenLabel} IS NOT DISTINCT FROM ${whenLabel}`))
    .orderBy(asc(rules.position))
    .limit(1);
  return row;
}

/** Whether any rule, of any kind, has exactly these conditions. */
export async function hasRuleFor(db: Sql, accountId: string, match: RuleMatch): Promise<boolean> {
  const found = await db
    .select({ id: rules.id })
    .from(rules)
    .where(and(eq(rules.accountId, accountId), eq(rules.match, match), eq(rules.except, [])))
    .limit(1);
  return found.length > 0;
}

/**
 * Say what mail matching `match` is or what happens to it, replacing the rule with exactly the same
 * conditions (and the same awaited label) if there is one. Returns the rule's id.
 */
export async function setRule(db: Sql, accountId: string, match: RuleMatch, rule: RuleSays, source: RuleSource, now: number = Date.now()): Promise<string> {
  // Whatever sift was proposing for this mail is settled by the user saying what it is.
  await db
    .update(proposals)
    .set({ status: 'accepted', resolvedAt: now })
    .where(and(eq(proposals.accountId, accountId), eq(proposals.match, match), eq(proposals.status, 'open')));
  const existing = await ruleMatching(db, accountId, match, rule.whenLabel ?? null);
  if (!existing) return await addRule(db, accountId, { match, ...rule }, source, now);
  await check(db, accountId, rule);
  await db
    .update(rules)
    .set({
      labelId: rule.labelId ?? null,
      disposition: rule.disposition ?? null,
      subscription: rule.subscription ?? 'preserve',
      markRead: rule.markRead ?? false,
      condition: rule.when?.trim() || null,
      source,
    })
    .where(eq(rules.id, existing.id));
  return existing.id;
}

/**
 * Block a sender: from now on their mail is `labelId` without being judged, whatever that label does.
 * A rule already made for exactly that sender is left alone. Returns true if a rule was written.
 */
export async function blockSender(db: Sql, accountId: string, address: string, labelId: string, now: number = Date.now()): Promise<boolean> {
  if (await ruleMatching(db, accountId, { from: address })) return false;
  await addRule(db, accountId, { match: { from: address }, labelId }, 'learned', now);
  return true;
}

/** A standing the owner can give by hand. `none` takes back whatever rule said so. */
type GivenStanding = 'trusted' | 'unwanted' | 'blocked' | 'none';

/**
 * Give a sender or a domain a standing, which is a rule for exactly them that says only what happens:
 * trusted keeps their mail, unwanted archives it, blocked marks it spam. It replaces any rule for all
 * their mail; rules that wait for a label stay.
 */
export async function setStanding(
  db: Sql,
  accountId: string,
  match: { from: string } | { fromDomain: string },
  standing: GivenStanding,
  now: number = Date.now(),
): Promise<void> {
  if (standing === 'none') {
    const existing = await ruleMatching(db, accountId, match);
    if (existing) await removeRule(db, existing.id);
    return;
  }
  await setRule(db, accountId, match, { disposition: standing === 'trusted' ? 'keep' : standing === 'unwanted' ? 'archive' : 'spam' }, 'user', now);
}
