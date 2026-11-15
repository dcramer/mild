import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Rule, RuleMatch } from '../triage/stages/rules.ts';
import type { DecidedDisposition, SubscriptionAction } from '../triage/types.ts';

export type RuleSource = 'user' | 'agent' | 'correction';

export interface StoredRule extends Rule {
  source: RuleSource;
  hits: number;
}

interface Row {
  id: string;
  match_json: string;
  except_json: string;
  disposition: DecidedDisposition;
  subscription: SubscriptionAction;
  label: string | null;
  source: RuleSource;
  hits: number;
}

/** An account's rules in evaluation order. */
export function listRules(db: DatabaseSync, accountId: string): StoredRule[] {
  const rows = db
    .prepare('SELECT id, match_json, except_json, disposition, subscription, label, source, hits FROM rules WHERE account_id = ? ORDER BY position, id')
    .all(accountId) as unknown as Row[];
  return rows.map((r) => {
    const except = JSON.parse(r.except_json) as RuleMatch[];
    return {
      id: r.id,
      match: JSON.parse(r.match_json) as RuleMatch,
      ...(except.length > 0 ? { except } : {}),
      disposition: r.disposition,
      subscription: r.subscription,
      ...(r.label ? { label: r.label } : {}),
      source: r.source,
      hits: r.hits,
    };
  });
}

/** Append a rule after the account's existing ones. Returns its id. */
export function addRule(db: DatabaseSync, accountId: string, rule: Omit<Rule, 'id'>, source: RuleSource, now: number = Date.now()): string {
  if (Object.values(rule.match).every((v) => v === undefined || v === '')) throw new Error('A rule needs at least one condition.');
  const id = `r-${randomBytes(4).toString('hex')}`;
  const { next } = db.prepare('SELECT coalesce(max(position), 0) + 1 AS next FROM rules WHERE account_id = ?').get(accountId) as { next: number };
  db.prepare(
    `INSERT INTO rules (id, account_id, position, match_json, except_json, disposition, subscription, label, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    accountId,
    next,
    JSON.stringify(rule.match),
    JSON.stringify(rule.except ?? []),
    rule.disposition,
    rule.subscription ?? 'preserve',
    rule.label ?? null,
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
