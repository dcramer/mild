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
  label_id: string;
  disposition: DecidedDisposition | null;
  subscription: SubscriptionAction;
  source: RuleSource;
  hits: number;
}

/** An account's rules in evaluation order. */
export function listRules(db: DatabaseSync, accountId: string): StoredRule[] {
  const rows = db
    .prepare('SELECT id, match_json, except_json, label_id, disposition, subscription, source, hits FROM rules WHERE account_id = ? ORDER BY position, id')
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
    `INSERT INTO rules (id, account_id, position, match_json, except_json, label_id, disposition, subscription, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    accountId,
    next,
    JSON.stringify(rule.match),
    JSON.stringify(rule.except ?? []),
    rule.labelId,
    rule.disposition ?? null,
    rule.subscription ?? 'preserve',
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

/** The rule that covers exactly one sender and nothing else, if there is one. */
function senderRule(db: DatabaseSync, accountId: string, address: string): { id: string; source: RuleSource } | undefined {
  return db
    .prepare(`SELECT id, source FROM rules WHERE account_id = ? AND match_json = ? AND except_json = '[]' ORDER BY position LIMIT 1`)
    .get(accountId, JSON.stringify({ from: address })) as { id: string; source: RuleSource } | undefined;
}

/**
 * Say what mail from one sender is, replacing whatever was said about that sender before.
 * `disposition` is an exception to the label's action for this sender only. Returns the rule's id.
 */
export function setSenderRule(
  db: DatabaseSync,
  accountId: string,
  address: string,
  rule: { labelId: string; disposition?: DecidedDisposition },
  source: RuleSource,
  now: number = Date.now(),
): string {
  const sender = address.toLowerCase();
  const existing = senderRule(db, accountId, sender);
  if (!existing) return addRule(db, accountId, { match: { from: sender }, ...rule }, source, now);
  db.prepare('UPDATE rules SET label_id = ?, disposition = ?, source = ? WHERE id = ?').run(rule.labelId, rule.disposition ?? null, source, existing.id);
  return existing.id;
}

/** How many consecutive model decisions must agree before sift makes a rule of them. */
export const LEARN_AFTER = 3;

/**
 * Make a rule for a sender once the model has given their last few messages the same label, so later
 * mail from them needs no inference. Senders who send mixed mail never settle and are never learned,
 * and a rule the user made for the sender is left alone. Returns true if a rule was written.
 */
export function learnSender(db: DatabaseSync, accountId: string, address: string, now: number = Date.now()): boolean {
  const recent = db
    .prepare(
      `SELECT d.label_id, d.disposition FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.from_address = ? AND d.stage = 'agent'
       ORDER BY d.id DESC LIMIT ?`,
    )
    .all(accountId, address, LEARN_AFTER) as unknown as { label_id: string | null; disposition: string }[];
  const [first] = recent;
  if (!first || recent.length < LEARN_AFTER || first.label_id === null) return false;
  const label = listLabels(db, accountId, now).find((l) => l.id === first.label_id);
  // Each must have ended the way the label says. One where a protection held sift back is not settled.
  if (!label || !recent.every((r) => r.label_id === first.label_id && r.disposition === label.disposition)) return false;
  const existing = senderRule(db, accountId, address);
  if (existing && existing.source !== 'agent') return false;
  setSenderRule(db, accountId, address, { labelId: first.label_id }, 'agent', now);
  return true;
}
