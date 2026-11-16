import { randomBytes } from 'node:crypto';
import type { Sql } from './sql.ts';
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
export async function listRules(db: Sql, accountId: string): Promise<StoredRule[]> {
  const rows = await db.all<Row>(
    'SELECT id, match_json, except_json, label_id, when_label, disposition, subscription, mark_read, condition, source, hits FROM rules WHERE account_id = ? ORDER BY position, id',
    accountId,
  );
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
async function check(db: Sql, accountId: string, rule: RuleSays, now: number): Promise<void> {
  if (rule.labelId === undefined && rule.whenLabel === undefined && rule.disposition === undefined)
    throw new Error('A rule needs a label, an action, or both.');
  if (rule.labelId !== undefined && rule.whenLabel !== undefined) throw new Error('A rule either says what mail is or waits for a label, not both.');
  if (rule.when?.trim() && rule.labelId === undefined) throw new Error('A condition in your own words needs a label for the mail it describes.');
  const named = rule.labelId ?? rule.whenLabel;
  if (named !== undefined && !(await listLabels(db, accountId, now)).some((l) => l.id === named)) throw new Error(`There is no label "${named}".`);
}

/** Append a rule after the account's existing ones. Returns its id. Throws if it has no condition, says nothing, or names no label of the account's. */
export async function addRule(db: Sql, accountId: string, rule: Omit<Rule, 'id' | 'learned'>, source: RuleSource, now: number = Date.now()): Promise<string> {
  if (Object.values(rule.match).every((v) => v === undefined || v === '')) throw new Error('A rule needs at least one condition.');
  await check(db, accountId, rule, now);
  const id = `r-${randomBytes(4).toString('hex')}`;
  const { next } = (await db.get<{ next: number }>('SELECT coalesce(max(position), 0) + 1 AS next FROM rules WHERE account_id = ?', accountId))!;
  await db.run(
    `INSERT INTO rules (id, account_id, position, match_json, except_json, label_id, when_label, disposition, subscription, mark_read, condition, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
export async function removeRule(db: Sql, id: string): Promise<boolean> {
  return (await db.run('DELETE FROM rules WHERE id = ?', id)).changes > 0;
}

export async function countRuleHit(db: Sql, id: string): Promise<void> {
  await db.run('UPDATE rules SET hits = hits + 1 WHERE id = ?', id);
}

/**
 * The rule with exactly these conditions and no exceptions, if there is one. A sender can have one rule
 * for all their mail and one for each label it might be, so `whenLabel` says which is meant: null for the
 * rule that waits for no label.
 */
export async function ruleMatching(
  db: Sql,
  accountId: string,
  match: RuleMatch,
  whenLabel: string | null = null,
): Promise<{ id: string; source: RuleSource } | undefined> {
  return await db.get<{ id: string; source: RuleSource }>(
    `SELECT id, source FROM rules WHERE account_id = ? AND match_json = ? AND except_json = '[]' AND when_label IS ? ORDER BY position LIMIT 1`,
    accountId,
    JSON.stringify(match),
    whenLabel,
  );
}

/** Whether any rule, of any kind, has exactly these conditions. */
export async function hasRuleFor(db: Sql, accountId: string, match: RuleMatch): Promise<boolean> {
  return (
    (await db.get(`SELECT 1 FROM rules WHERE account_id = ? AND match_json = ? AND except_json = '[]' LIMIT 1`, accountId, JSON.stringify(match))) !== undefined
  );
}

/**
 * Say what mail matching `match` is or what happens to it, replacing the rule with exactly the same
 * conditions (and the same awaited label) if there is one. Returns the rule's id.
 */
export async function setRule(db: Sql, accountId: string, match: RuleMatch, rule: RuleSays, source: RuleSource, now: number = Date.now()): Promise<string> {
  // Whatever sift was proposing for this mail is settled by the user saying what it is.
  await db.run(
    `UPDATE proposals SET status = 'accepted', resolved_at = ? WHERE account_id = ? AND match_json = ? AND status = 'open'`,
    now,
    accountId,
    JSON.stringify(match),
  );
  const existing = await ruleMatching(db, accountId, match, rule.whenLabel ?? null);
  if (!existing) return await addRule(db, accountId, { match, ...rule }, source, now);
  await check(db, accountId, rule, now);
  await db.run(
    'UPDATE rules SET label_id = ?, disposition = ?, subscription = ?, mark_read = ?, condition = ?, source = ? WHERE id = ?',
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
 * Block a sender: from now on their mail is `labelId` without being judged, whatever that label does.
 * A rule already made for exactly that sender is left alone. Returns true if a rule was written.
 */
export async function blockSender(db: Sql, accountId: string, address: string, labelId: string, now: number = Date.now()): Promise<boolean> {
  if (await ruleMatching(db, accountId, { from: address })) return false;
  await addRule(db, accountId, { match: { from: address }, labelId }, 'agent', now);
  return true;
}

/** A standing the owner can give by hand. `none` takes back whatever rule said so. */
export type GivenStanding = 'trusted' | 'unwanted' | 'blocked' | 'none';

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
