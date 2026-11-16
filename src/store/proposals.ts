import type { DatabaseSync } from 'node:sqlite';
import type { RuleMatch } from '../triage/stages/rules.ts';
import { listLabels } from './labels.ts';
import { hasRuleFor, listRules, removeRule, setRule } from './rules.ts';

/** `rule`: make a rule for `match`. `always`: stop having the model check `ruleId`. */
export type ProposalKind = 'rule' | 'always';

export interface Proposal {
  id: number;
  accountId: string;
  kind: ProposalKind;
  match: RuleMatch;
  labelId: string;
  ruleId: string | null;
  /** How many decisions in a row it rests on. */
  agreed: number;
  createdAt: number;
}

interface Row {
  id: number;
  account_id: string;
  kind: ProposalKind;
  match_json: string;
  label_id: string;
  rule_id: string | null;
  agreed: number;
  created_at: number;
}

const toProposal = (r: Row): Proposal => ({
  id: r.id,
  accountId: r.account_id,
  kind: r.kind,
  match: JSON.parse(r.match_json) as RuleMatch,
  labelId: r.label_id,
  ruleId: r.rule_id,
  agreed: r.agreed,
  createdAt: r.created_at,
});

export function listProposals(db: DatabaseSync, accountId?: string): Proposal[] {
  const rows = db
    .prepare(
      `SELECT id, account_id, kind, match_json, label_id, rule_id, agreed, created_at FROM proposals
       WHERE status = 'open' ${accountId === undefined ? '' : 'AND account_id = ?'} ORDER BY created_at DESC, id DESC`,
    )
    .all(...(accountId === undefined ? [] : [accountId])) as unknown as Row[];
  return rows.map(toProposal);
}

/** Open a proposal, or refresh the count on one already open. One the user dismissed stays dismissed. Returns true if it is new. */
function propose(db: DatabaseSync, p: Omit<Proposal, 'id' | 'createdAt'>, now: number): boolean {
  const match = JSON.stringify(p.match);
  const existing = db.prepare('SELECT id, status FROM proposals WHERE account_id = ? AND kind = ? AND match_json = ?').get(p.accountId, p.kind, match) as
    | { id: number; status: string }
    | undefined;
  if (existing) {
    if (existing.status === 'open')
      db.prepare('UPDATE proposals SET agreed = ?, label_id = ?, rule_id = ? WHERE id = ?').run(p.agreed, p.labelId, p.ruleId, existing.id);
    return false;
  }
  db.prepare('INSERT INTO proposals (account_id, kind, match_json, label_id, rule_id, agreed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    p.accountId,
    p.kind,
    match,
    p.labelId,
    p.ruleId,
    p.agreed,
    now,
  );
  return true;
}

/** How many model decisions in a row must agree before sift proposes a rule for the sender. */
export const PROPOSE_AFTER = 5;
/** How many times in a row the model must agree with a `usually` rule before sift proposes to stop checking it. */
export const SETTLED_AFTER = 10;

/**
 * Propose a rule for a sender once the model has given their last few messages the same label and each
 * ended the way the label says. Senders who send mixed mail never settle. Nothing is proposed where a
 * rule for exactly that sender exists. Returns true if a proposal was opened.
 */
export function proposeForSender(db: DatabaseSync, accountId: string, address: string, now: number = Date.now()): boolean {
  if (hasRuleFor(db, accountId, { from: address })) return false;
  const recent = db
    .prepare(
      `SELECT d.label_id, d.disposition, d.prior_rule_id FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.from_address = ? AND d.stage = 'agent'
       ORDER BY d.id DESC LIMIT ?`,
    )
    .all(accountId, address, PROPOSE_AFTER) as unknown as { label_id: string | null; disposition: string; prior_rule_id: string | null }[];
  const [first] = recent;
  if (!first || recent.length < PROPOSE_AFTER || first.label_id === null) return false;
  const label = listLabels(db, accountId, now).find((l) => l.id === first.label_id);
  // One where a protection held sift back, or a wider rule already spoke, is not settled.
  if (!label || !recent.every((r) => r.label_id === first.label_id && r.disposition === label.disposition && r.prior_rule_id === null)) return false;
  return propose(db, { accountId, kind: 'rule', match: { from: address }, labelId: first.label_id, ruleId: null, agreed: recent.length }, now);
}

/** Propose dropping the "when it is L" from a rule once every message it was checked against turned out to be L, for long enough. */
export function proposeSettled(db: DatabaseSync, accountId: string, ruleId: string, now: number = Date.now()): boolean {
  const rule = listRules(db, accountId).find((r) => r.id === ruleId);
  if (!rule || rule.whenLabel === undefined) return false;
  const recent = db.prepare('SELECT rule_id FROM decisions WHERE prior_rule_id = ? ORDER BY id DESC LIMIT ?').all(ruleId, SETTLED_AFTER) as unknown as {
    rule_id: string | null;
  }[];
  if (recent.length < SETTLED_AFTER || !recent.every((r) => r.rule_id === ruleId)) return false;
  return propose(db, { accountId, kind: 'always', match: rule.match, labelId: rule.whenLabel, ruleId, agreed: recent.length }, now);
}

/**
 * Accept or dismiss a proposal. Accepting writes the rule as the user's own, or turns a rule that waited
 * for a label into one that acts on everything it matches. Returns false if it was not open.
 */
export function resolveProposal(db: DatabaseSync, id: number, accept: boolean, now: number = Date.now()): boolean {
  const row = db
    .prepare(`SELECT id, account_id, kind, match_json, label_id, rule_id, agreed, created_at FROM proposals WHERE id = ? AND status = 'open'`)
    .get(id) as Row | undefined;
  if (!row) return false;
  const p = toProposal(row);
  if (accept) {
    const existing = p.ruleId ? listRules(db, p.accountId).find((r) => r.id === p.ruleId) : undefined;
    if (existing) {
      // What the rule did when the mail was that label, it now does to all of it, without waiting to be told.
      const does = existing.disposition ?? listLabels(db, p.accountId, now).find((l) => l.id === p.labelId)?.disposition ?? 'keep';
      removeRule(db, existing.id);
      setRule(
        db,
        p.accountId,
        p.match,
        {
          disposition: does === 'review' ? 'keep' : does,
          ...(existing.subscription ? { subscription: existing.subscription } : {}),
          ...(existing.markRead ? { markRead: true } : {}),
        },
        'user',
        now,
      );
    } else setRule(db, p.accountId, p.match, { labelId: p.labelId }, 'user', now);
  }
  db.prepare('UPDATE proposals SET status = ?, resolved_at = ? WHERE id = ?').run(accept ? 'accepted' : 'dismissed', now, id);
  return true;
}
