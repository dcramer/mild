import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Rule, RuleMatch } from '../triage/stages/rules.ts';
import type { DecidedDisposition, SubscriptionAction } from '../triage/types.ts';
import { listLabels } from './labels.ts';

/** `user`: the user wrote it. `correction`: it came from the user correcting sift. `agent`: sift learned it. */
export type RuleSource = 'user' | 'agent' | 'correction';

export interface StoredRule extends Rule {
  source: RuleSource;
  hits: number;
}

interface Row {
  id: string;
  match_json: string;
  except_json: string;
  label_id: string | null;
  when_label: string | null;
  disposition: DecidedDisposition | null;
  subscription: SubscriptionAction;
  mark_read: number;
  condition: string | null;
  source: RuleSource;
  hits: number;
}

/** An account's rules in evaluation order. */
export function listRules(db: DatabaseSync, accountId: string): StoredRule[] {
  const rows = db
    .prepare(
      'SELECT id, match_json, except_json, label_id, when_label, disposition, subscription, mark_read, condition, source, hits FROM rules WHERE account_id = ? ORDER BY position, id',
    )
    .all(accountId) as unknown as Row[];
  return rows.map((r) => {
    const except = JSON.parse(r.except_json) as RuleMatch[];
    return {
      id: r.id,
      match: JSON.parse(r.match_json) as RuleMatch,
      ...(except.length > 0 ? { except } : {}),
      ...(r.label_id ? { labelId: r.label_id } : {}),
      ...(r.when_label ? { whenLabel: r.when_label } : {}),
      ...(r.disposition ? { disposition: r.disposition } : {}),
      subscription: r.subscription,
      ...(r.mark_read === 1 ? { markRead: true } : {}),
      ...(r.condition ? { when: r.condition } : {}),
      ...(r.source === 'agent' ? { learned: true } : {}),
      source: r.source,
      hits: r.hits,
    };
  });
}

/** What a rule says, apart from its conditions. */
export type RuleSays = Pick<Rule, 'labelId' | 'whenLabel' | 'disposition' | 'subscription' | 'markRead' | 'when'>;

/** Throws, with a sentence for the user, unless `rule` says something sift can act on with the account's labels. */
function check(db: DatabaseSync, accountId: string, rule: RuleSays, now: number): void {
  if (rule.labelId === undefined && rule.whenLabel === undefined && rule.disposition === undefined)
    throw new Error('A rule needs a label, an action, or both.');
  if (rule.labelId !== undefined && rule.whenLabel !== undefined) throw new Error('A rule either says what mail is or waits for a label, not both.');
  if (rule.when?.trim() && rule.labelId === undefined) throw new Error('A condition in your own words needs a label for the mail it describes.');
  const named = rule.labelId ?? rule.whenLabel;
  if (named !== undefined && !listLabels(db, accountId, now).some((l) => l.id === named)) throw new Error(`There is no label "${named}".`);
}

/** Append a rule after the account's existing ones. Returns its id. Throws if it has no condition, says nothing, or names no label of the account's. */
export function addRule(db: DatabaseSync, accountId: string, rule: Omit<Rule, 'id' | 'learned'>, source: RuleSource, now: number = Date.now()): string {
  if (Object.values(rule.match).every((v) => v === undefined || v === '')) throw new Error('A rule needs at least one condition.');
  check(db, accountId, rule, now);
  const id = `r-${randomBytes(4).toString('hex')}`;
  const { next } = db.prepare('SELECT coalesce(max(position), 0) + 1 AS next FROM rules WHERE account_id = ?').get(accountId) as { next: number };
  db.prepare(
    `INSERT INTO rules (id, account_id, position, match_json, except_json, label_id, when_label, disposition, subscription, mark_read, condition, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    accountId,
    next,
    JSON.stringify(rule.match),
    JSON.stringify(rule.except ?? []),
    rule.labelId ?? null,
    rule.whenLabel ?? null,
    rule.disposition ?? null,
    rule.subscription ?? 'preserve',
    rule.markRead ? 1 : 0,
    rule.when?.trim() || null,
    source,
    now,
  );
  return id;
}

/** Returns false if there was no such rule. Past decisions keep the rule id as history. */
export function removeRule(db: DatabaseSync, id: string): boolean {
  return Number(db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes) > 0;
}

export function countRuleHit(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE rules SET hits = hits + 1 WHERE id = ?').run(id);
}

/**
 * The rule with exactly these conditions and no exceptions, if there is one. A sender can have one rule
 * for all their mail and one for each label it might be, so `whenLabel` says which is meant: null for the
 * rule that waits for no label.
 */
export function ruleMatching(
  db: DatabaseSync,
  accountId: string,
  match: RuleMatch,
  whenLabel: string | null = null,
): { id: string; source: RuleSource } | undefined {
  return db
    .prepare(`SELECT id, source FROM rules WHERE account_id = ? AND match_json = ? AND except_json = '[]' AND when_label IS ? ORDER BY position LIMIT 1`)
    .get(accountId, JSON.stringify(match), whenLabel) as { id: string; source: RuleSource } | undefined;
}

/** Whether any rule, of any kind, has exactly these conditions. */
export function hasRuleFor(db: DatabaseSync, accountId: string, match: RuleMatch): boolean {
  return (
    db.prepare(`SELECT 1 FROM rules WHERE account_id = ? AND match_json = ? AND except_json = '[]' LIMIT 1`).get(accountId, JSON.stringify(match)) !== undefined
  );
}

/**
 * Say what mail matching `match` is or what happens to it, replacing the rule with exactly the same
 * conditions (and the same awaited label) if there is one. Returns the rule's id.
 */
export function setRule(db: DatabaseSync, accountId: string, match: RuleMatch, rule: RuleSays, source: RuleSource, now: number = Date.now()): string {
  // Whatever sift was proposing for this mail is settled by the user saying what it is.
  db.prepare(`UPDATE proposals SET status = 'accepted', resolved_at = ? WHERE account_id = ? AND match_json = ? AND status = 'open'`).run(
    now,
    accountId,
    JSON.stringify(match),
  );
  const existing = ruleMatching(db, accountId, match, rule.whenLabel ?? null);
  if (!existing) return addRule(db, accountId, { match, ...rule }, source, now);
  check(db, accountId, rule, now);
  db.prepare('UPDATE rules SET label_id = ?, disposition = ?, subscription = ?, mark_read = ?, condition = ?, source = ? WHERE id = ?').run(
    rule.labelId ?? null,
    rule.disposition ?? null,
    rule.subscription ?? 'preserve',
    rule.markRead ? 1 : 0,
    rule.when?.trim() || null,
    source,
    existing.id,
  );
  return existing.id;
}

/**
 * As `setRule`, and the only rule left with exactly these conditions: an answer about a sender replaces
 * whatever was said about them before, of any kind.
 */
export function replaceRules(db: DatabaseSync, accountId: string, match: RuleMatch, rule: RuleSays, source: RuleSource, now: number = Date.now()): string {
  const id = setRule(db, accountId, match, rule, source, now);
  db.prepare(`DELETE FROM rules WHERE account_id = ? AND match_json = ? AND except_json = '[]' AND id != ?`).run(accountId, JSON.stringify(match), id);
  return id;
}

/**
 * Block a sender: from now on their mail is `labelId` without being judged, whatever that label does.
 * A rule already made for exactly that sender is left alone. Returns true if a rule was written.
 */
export function blockSender(db: DatabaseSync, accountId: string, address: string, labelId: string, now: number = Date.now()): boolean {
  if (ruleMatching(db, accountId, { from: address })) return false;
  addRule(db, accountId, { match: { from: address }, labelId }, 'agent', now);
  return true;
}

/** A standing the owner can give by hand. `none` takes back whatever rule said so. */
export type GivenStanding = 'trusted' | 'unwanted' | 'blocked' | 'none';

/**
 * Give a sender or a domain a standing, which is a rule for exactly them that says only what happens:
 * trusted keeps their mail, unwanted archives it, blocked marks it spam. It replaces any rule for all
 * their mail; rules that wait for a label stay.
 */
export function setStanding(
  db: DatabaseSync,
  accountId: string,
  match: { from: string } | { fromDomain: string },
  standing: GivenStanding,
  now: number = Date.now(),
): void {
  if (standing === 'none') {
    const existing = ruleMatching(db, accountId, match);
    if (existing) removeRule(db, existing.id);
    return;
  }
  setRule(db, accountId, match, { disposition: standing === 'trusted' ? 'keep' : standing === 'unwanted' ? 'archive' : 'spam' }, 'user', now);
}
