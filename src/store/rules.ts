import { randomBytes } from 'node:crypto';
import { type RULE_SOURCES, and, asc, eq, ne, proposals, ruleDrafts, rules, sql } from './query.ts';
import { costOf } from './runs.ts';
import type { Sql } from './sql.ts';
import { conditionsHash, openJson, ruleDraftName, ruleName, sealJson } from './content.ts';
import type { RuleDraft } from '../triage/rule-draft.ts';
import type { Usage } from '../triage/stages/model.ts';
import { type Rule, type RuleMatch, tidyMatch } from '../triage/stages/rules.ts';
import { listLabels } from './labels.ts';
import { LEAVE_IN_INBOX } from '../triage/types.ts';
import type { Given } from '../triage/standing.ts';
import { Refusal } from '../refusal.ts';
import { plain } from '../plain.ts';

/** `user`: the user wrote it. `correction`: it came from the user correcting sift. `learned`: Mild made it when it blocked the sender. */
type RuleSource = (typeof RULE_SOURCES)[number];

interface StoredRule extends Rule {
  source: RuleSource;
  hits: number;
}

/** The person's rules in evaluation order, for every mailbox of theirs. */
export async function listRules(db: Sql): Promise<StoredRule[]> {
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
      name: rules.name,
      source: rules.source,
      hits: rules.hits,
    })
    .from(rules)
    .orderBy(asc(rules.position), asc(rules.id));
  return rows.map((r) => {
    const except = plain(openJson<RuleMatch[]>(db, ruleName(db, r.id, 'except'), r.except));
    return {
      id: r.id,
      match: plain(openJson<RuleMatch>(db, ruleName(db, r.id, 'match'), r.match)),
      ...(except.length > 0 ? { except } : {}),
      ...(r.labelId ? { labelId: r.labelId } : {}),
      ...(r.whenLabel ? { whenLabel: r.whenLabel } : {}),
      ...(r.disposition ? { disposition: r.disposition } : {}),
      subscription: r.subscription,
      ...(r.markRead ? { markRead: true } : {}),
      ...(r.condition ? { when: r.condition } : {}),
      ...(r.source === 'learned' ? { learned: true } : {}),
      ...(r.name === null ? {} : { name: plain(openJson<string>(db, ruleName(db, r.id, 'name'), r.name)) }),
      source: r.source,
      hits: r.hits,
    };
  });
}

/** What a rule says, apart from its conditions. */
export type RuleSays = Pick<Rule, 'labelId' | 'whenLabel' | 'disposition' | 'subscription' | 'markRead' | 'when'> & {
  /** Null takes a name away; left out, a rule replaced keeps its own. */
  name?: string | null;
};

const sealName = (db: Sql, id: string, name: string | null | undefined) => {
  const given = name?.replace(/\s+/g, ' ').trim();
  return given ? sealJson(db, ruleName(db, id, 'name'), given) : null;
};

/**
 * Leaving mail in the inbox and nothing else is Leave in inbox, whoever asks: one form, which can also carry a
 * condition in words. Keeping with an extra (mark read, unsubscribe) stays an action of its own.
 */
function leaveInInbox<T extends RuleSays>(rule: T): T {
  const alone = rule.labelId === undefined && rule.whenLabel === undefined && rule.disposition === 'keep';
  if (!alone || rule.markRead || rule.subscription === 'unsubscribe') return rule;
  const { disposition, ...rest } = rule;
  return { ...rest, labelId: LEAVE_IN_INBOX } as T;
}

/** Throws, with a sentence for the user, unless `rule` says something Mild can act on with the person's labels. */
async function check(db: Sql, rule: RuleSays): Promise<void> {
  if (rule.labelId === undefined && rule.whenLabel === undefined && rule.disposition === undefined)
    throw new Refusal('A rule needs a label, an action, or both.');
  if (rule.labelId !== undefined && rule.whenLabel !== undefined) throw new Refusal('A rule either says what mail is or waits for a label, not both.');
  if (rule.when?.trim() && rule.labelId === undefined) throw new Refusal('A condition in your own words needs a label for the mail it describes.');
  const named = rule.labelId ?? rule.whenLabel;
  if (named !== undefined && !(await listLabels(db)).some((l) => l.id === named)) throw new Refusal(`There is no label "${named}".`);
}

/** Append a rule after the person's existing ones. Returns its id. Throws if it has no condition, says nothing, or names no label of theirs. */
export async function addRule(
  db: Sql,
  given: Omit<Rule, 'id' | 'learned' | 'name'> & Pick<RuleSays, 'name'>,
  source: RuleSource,
  now: number = Date.now(),
): Promise<string> {
  const rule = leaveInInbox({ ...given, match: tidyMatch(given.match), ...(given.except ? { except: given.except.map(tidyMatch) } : {}) });
  if (Object.keys(rule.match).length === 0) throw new Refusal('A rule needs at least one condition.');
  await check(db, rule);
  const id = `r-${randomBytes(4).toString('hex')}`;
  const [{ next }] = (await db.select({ next: sql<number>`coalesce(max(${rules.position}), 0) + 1`.mapWith(Number) }).from(rules)) as [{ next: number }];
  await db.insert(rules).values({
    id,
    position: next,
    match: sealJson(db, ruleName(db, id, 'match'), rule.match),
    except: sealJson(db, ruleName(db, id, 'except'), rule.except ?? []),
    conditions: conditionsHash(db, rule.match, rule.except),
    name: sealName(db, id, rule.name),
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
/** Whose the removed rule was, or null when there was no such rule. */
export async function removeRule(db: Sql, id: string): Promise<RuleSource | null> {
  const [removed] = await db.delete(rules).where(eq(rules.id, id)).returning({ source: rules.source });
  return removed?.source ?? null;
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
async function ruleMatching(db: Sql, match: RuleMatch, whenLabel: string | null = null): Promise<{ id: string; source: RuleSource } | undefined> {
  const [row] = await db
    .select({ id: rules.id, source: rules.source })
    .from(rules)
    .where(and(eq(rules.conditions, conditionsHash(db, match)), sql`${rules.whenLabel} IS NOT DISTINCT FROM ${whenLabel}`))
    .orderBy(asc(rules.position))
    .limit(1);
  return row;
}

/** Whether a rule has exactly these conditions and waits for `whenLabel` (none: a rule for all the mail they match). */
export async function hasRuleFor(db: Sql, match: RuleMatch, whenLabel: string | null = null): Promise<boolean> {
  return (await ruleMatching(db, match, whenLabel)) !== undefined;
}

/**
 * Say what mail matching `match` is or what happens to it, replacing the rule with exactly the same
 * conditions (and the same awaited label) if there is one. Returns the rule's id.
 */
export async function setRule(db: Sql, match: RuleMatch, says: RuleSays, source: RuleSource, now: number = Date.now()): Promise<string> {
  const rule = leaveInInbox(says);
  await settleProposals(db, match, now);
  const existing = await ruleMatching(db, match, rule.whenLabel ?? null);
  if (!existing) return await addRule(db, { match, ...rule }, source, now);
  await check(db, rule);
  await db
    .update(rules)
    .set({
      labelId: rule.labelId ?? null,
      disposition: rule.disposition ?? null,
      subscription: rule.subscription ?? 'preserve',
      markRead: rule.markRead ?? false,
      condition: rule.when?.trim() || null,
      ...(rule.name === undefined ? {} : { name: sealName(db, existing.id, rule.name) }),
      source,
    })
    .where(eq(rules.id, existing.id));
  return existing.id;
}

/** Whatever Mild was proposing for this mail, in any mailbox, is settled by the user saying what it is. */
async function settleProposals(db: Sql, match: RuleMatch, now: number): Promise<void> {
  await db
    .update(proposals)
    .set({ status: 'accepted', resolvedAt: now })
    .where(and(eq(proposals.conditions, conditionsHash(db, match)), eq(proposals.status, 'open')));
}

/**
 * Change what rule `id` matches and says, keeping its place, its exceptions, its count and its Gmail filter, which
 * the filter check brings into line. The user wrote it now, whoever made it. Refuses when another rule already has
 * exactly these conditions and waits for the same label: two would leave which one decides to their order.
 */
export async function editRule(db: Sql, id: string, match: RuleMatch, says: RuleSays, now: number = Date.now()): Promise<void> {
  const rule = leaveInInbox(says);
  const tidy = tidyMatch(match);
  if (Object.keys(tidy).length === 0) throw new Refusal('A rule needs at least one condition.');
  const [row] = await db.select({ except: rules.except }).from(rules).where(eq(rules.id, id));
  if (!row) throw new Refusal('That rule no longer exists.');
  await check(db, rule);
  const except = plain(openJson<RuleMatch[]>(db, ruleName(db, id, 'except'), row.except));
  const conditions = conditionsHash(db, tidy, except);
  const [twin] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(and(eq(rules.conditions, conditions), sql`${rules.whenLabel} IS NOT DISTINCT FROM ${rule.whenLabel ?? null}`, ne(rules.id, id)))
    .limit(1);
  if (twin) throw new Refusal('Another rule already has exactly these conditions. Change that one, or remove it first.');
  await settleProposals(db, tidy, now);
  await db
    .update(rules)
    .set({
      match: sealJson(db, ruleName(db, id, 'match'), tidy),
      conditions,
      name: sealName(db, id, rule.name),
      labelId: rule.labelId ?? null,
      whenLabel: rule.whenLabel ?? null,
      disposition: rule.disposition ?? null,
      subscription: rule.subscription ?? 'preserve',
      markRead: rule.markRead ?? false,
      condition: rule.when?.trim() || null,
      source: 'user',
    })
    .where(eq(rules.id, id));
}

/**
 * Block a sender: from now on their mail is `labelId` without being judged, whatever that label does.
 * A rule already made for exactly that sender is left alone. Returns true if a rule was written.
 */
export async function blockSender(db: Sql, address: string, labelId: string, now: number = Date.now()): Promise<boolean> {
  if (await ruleMatching(db, { from: [address] })) return false;
  await addRule(db, { match: { from: [address] }, labelId }, 'learned', now);
  return true;
}

/** The user's own rule for exactly this address or domain, which is what their standing is read from. */
export async function standingRule(db: Sql, match: { from: [string] } | { fromDomain: [string] }): Promise<string | null> {
  return (await ruleMatching(db, match))?.id ?? null;
}

const STANDING_DOES = { trusted: 'keep', unwanted: 'archive', blocked: 'spam' } as const;

/** The standing a rule for exactly one sender or domain gives them, or null when it says more than what happens to their mail. */
function standingOfRule(rule: Rule): Given | null {
  if (rule.except || rule.when || rule.markRead || rule.subscription === 'unsubscribe') return null;
  if (rule.labelId === LEAVE_IN_INBOX && !rule.disposition) return 'trusted';
  if (rule.labelId) return null;
  return rule.disposition === 'archive' ? 'unwanted' : rule.disposition === 'spam' ? 'blocked' : null;
}

/**
 * Give a sender or domain a standing in one press: their own rule that says only what happens to their mail.
 * It replaces a rule for exactly them only when that is a standing too, and says which (`was`) so Undo can
 * give it back. A rule that says more (a label, an exception, an extra) is not replaced: the user changes it
 * in the rule dialog, where they see what they lose, and `theirs` names it.
 */
export async function giveStanding(
  db: Sql,
  match: { from: [string] } | { fromDomain: [string] },
  standing: Given,
  now: number,
): Promise<{ id: string; was: Given | null } | { theirs: string }> {
  const existing = await ruleMatching(db, match);
  const rule = existing && (await listRules(db)).find((r) => r.id === existing.id);
  const was = rule ? standingOfRule(rule) : null;
  if (rule && !was) return { theirs: rule.id };
  return { id: await setRule(db, match, { disposition: STANDING_DOES[standing] }, 'user', now), was };
}

/** Record a call for a rule before it is made. */
export async function startRuleDraft(db: Sql, request: { accountId: string; goal: string; model: string; now: number }): Promise<number> {
  const [row] = await db
    .insert(ruleDrafts)
    .values({
      accountId: request.accountId,
      startedAt: request.now,
      model: request.model,
      goal: sealJson(db, ruleDraftName(db, request.accountId, 'goal'), request.goal),
    })
    .returning({ id: ruleDrafts.id });
  return row!.id;
}

/** What the call filled in, or why it failed, and what it cost. */
export async function finishRuleDraft(
  db: Sql,
  accountId: string,
  id: number,
  outcome: ({ draft: RuleDraft } | { error: string }) & { usage?: Usage; lookups: number; now: number },
): Promise<void> {
  await db
    .update(ruleDrafts)
    .set({
      finishedAt: outcome.now,
      lookups: outcome.lookups,
      ...('draft' in outcome ? { rule: sealJson(db, ruleDraftName(db, accountId, 'rule'), outcome.draft) } : { error: outcome.error }),
      ...costOf(outcome.usage),
    })
    .where(eq(ruleDrafts.id, id));
}
