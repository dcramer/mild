import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Rule, RuleMatch, RuleTier } from '../triage/stages/rules.ts';
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
  label_id: string;
  disposition: DecidedDisposition | null;
  subscription: SubscriptionAction;
  mark_read: number;
  tier: RuleTier;
  condition: string | null;
  source: RuleSource;
  hits: number;
}

/** An account's rules in evaluation order. */
export function listRules(db: DatabaseSync, accountId: string): StoredRule[] {
  const rows = db
    .prepare(
      'SELECT id, match_json, except_json, label_id, disposition, subscription, mark_read, tier, condition, source, hits FROM rules WHERE account_id = ? ORDER BY position, id',
    )
    .all(accountId) as unknown as Row[];
  return rows.map((r) => {
    const except = JSON.parse(r.except_json) as RuleMatch[];
    return {
      id: r.id,
      match: JSON.parse(r.match_json) as RuleMatch,
      ...(except.length > 0 ? { except } : {}),
      labelId: r.label_id,
      ...(r.disposition ? { disposition: r.disposition } : {}),
      subscription: r.subscription,
      ...(r.mark_read === 1 ? { markRead: true } : {}),
      ...(r.tier === 'usually' ? { tier: r.tier } : {}),
      ...(r.condition ? { when: r.condition } : {}),
      ...(r.source === 'agent' ? { learned: true } : {}),
      source: r.source,
      hits: r.hits,
    };
  });
}

/** Append a rule after the account's existing ones. Returns its id. Throws if it has no condition or names no label of the account's. */
export function addRule(db: DatabaseSync, accountId: string, rule: Omit<Rule, 'id' | 'learned'>, source: RuleSource, now: number = Date.now()): string {
  if (Object.values(rule.match).every((v) => v === undefined || v === '')) throw new Error('A rule needs at least one condition.');
  if (!listLabels(db, accountId, now).some((l) => l.id === rule.labelId)) throw new Error(`There is no label "${rule.labelId}".`);
  const id = `r-${randomBytes(4).toString('hex')}`;
  const { next } = db.prepare('SELECT coalesce(max(position), 0) + 1 AS next FROM rules WHERE account_id = ?').get(accountId) as { next: number };
  db.prepare(
    `INSERT INTO rules (id, account_id, position, match_json, except_json, label_id, disposition, subscription, mark_read, tier, condition, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    accountId,
    next,
    JSON.stringify(rule.match),
    JSON.stringify(rule.except ?? []),
    rule.labelId,
    rule.disposition ?? null,
    rule.subscription ?? 'preserve',
    rule.markRead ? 1 : 0,
    rule.tier ?? 'always',
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

/** The rule with exactly these conditions and no exceptions, if there is one. */
export function ruleMatching(db: DatabaseSync, accountId: string, match: RuleMatch): { id: string; source: RuleSource } | undefined {
  return db
    .prepare(`SELECT id, source FROM rules WHERE account_id = ? AND match_json = ? AND except_json = '[]' ORDER BY position LIMIT 1`)
    .get(accountId, JSON.stringify(match)) as { id: string; source: RuleSource } | undefined;
}

/**
 * Say what mail matching `match` is, replacing a rule with exactly the same conditions if there is one.
 * `disposition` is an exception to the label's action for this rule only. Returns the rule's id.
 */
export function setRule(
  db: DatabaseSync,
  accountId: string,
  match: RuleMatch,
  rule: { labelId: string; disposition?: DecidedDisposition; subscription?: SubscriptionAction; markRead?: boolean; tier?: RuleTier; when?: string },
  source: RuleSource,
  now: number = Date.now(),
): string {
  // Whatever sift was proposing for this mail is settled by the user saying what it is.
  db.prepare(`UPDATE proposals SET status = 'accepted', resolved_at = ? WHERE account_id = ? AND match_json = ? AND status = 'open'`).run(
    now,
    accountId,
    JSON.stringify(match),
  );
  const existing = ruleMatching(db, accountId, match);
  if (!existing) return addRule(db, accountId, { match, ...rule }, source, now);
  db.prepare('UPDATE rules SET label_id = ?, disposition = ?, subscription = ?, mark_read = ?, tier = ?, condition = ?, source = ? WHERE id = ?').run(
    rule.labelId,
    rule.disposition ?? null,
    rule.subscription ?? 'preserve',
    rule.markRead ? 1 : 0,
    rule.tier ?? 'always',
    rule.when?.trim() || null,
    source,
    existing.id,
  );
  return existing.id;
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
