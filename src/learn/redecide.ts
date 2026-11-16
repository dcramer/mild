import type { DatabaseSync } from 'node:sqlite';
import { recordDecision } from '../store/decisions.ts';
import { listLabels } from '../store/labels.ts';
import { getFacts } from '../store/messages.ts';
import { countRuleHit, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import { rulesStage } from '../triage/stages/rules.ts';
import { type Decision, type Disposition, type StageName, labelled } from '../triage/types.ts';
import { type Suggestion, pendingSuggestions } from './feedback.ts';

interface Standing {
  id: number;
  stage: StageName;
  disposition: Disposition;
  subscription: Decision['subscription'];
  label_id: string | null;
  block: number;
  mark_read: number;
  confidence: number | null;
  reason: string;
}

const COLUMNS = 'id, stage, disposition, subscription, label_id, block, mark_read, confidence, reason';
const WILL: Record<Disposition, string> = { keep: 'kept', archive: 'archived', spam: 'marked as spam', review: 'left for you' };
const hides = (disposition: Disposition) => disposition === 'archive' || disposition === 'spam';

const same = (standing: Standing, next: Decision) =>
  standing.disposition === next.disposition &&
  standing.label_id === (next.labelId ?? null) &&
  standing.subscription === next.subscription &&
  (standing.block === 1) === (next.block ?? false) &&
  (standing.mark_read === 1) === (next.markRead ?? false);

/**
 * Bring an account's waiting suggestions into line with its rules and labels as they are now, without
 * a model. Call it after a rule or a label changes. For each one:
 *
 * - a rule now decides it: that decision is recorded (a rule of the user's settles it, so it stops
 *   being a suggestion; a rule sift learned only counts if the outcome differs);
 * - no rule does, and its label now has a different outcome: the same label is recorded with the new
 *   outcome. The label is still the tier's word; only what follows from it is worked out again;
 * - the rule that decided it has gone: it goes back to what a tier said before the rule, or to review.
 *
 * Mail a rule decided only because of an earlier call here is included, so removing that rule brings
 * the suggestion back. Mail the user answered for is never touched. Returns how many decisions were recorded.
 */
export async function redecideWaiting(db: DatabaseSync, accountId: string, now: number = Date.now()): Promise<number> {
  const labels = listLabels(db, accountId, now);
  const stored = listRules(db, accountId);
  const written = (address: string) => cachedCorrespondent(db, accountId, address, now);
  const rules = rulesStage(stored, labels, { hasWritten: (facts) => written(facts.from.address) });
  const standing = db.prepare(`SELECT ${COLUMNS} FROM decisions WHERE id = ?`);
  const judged = db.prepare(`SELECT ${COLUMNS} FROM decisions WHERE account_id = ? AND message_id = ? AND stage != 'rules' ORDER BY id DESC LIMIT 1`);
  // Decided by a rule that no longer exists, after another tier had already decided it, and never answered.
  const orphaned = db
    .prepare(
      `SELECT d.id AS decisionId, d.message_id AS messageId FROM decisions d
       WHERE d.account_id = ? AND d.mode = 'observe' AND d.stage = 'rules' AND d.rule_id IS NOT NULL
         AND d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
         AND NOT EXISTS (SELECT 1 FROM rules r WHERE r.id = d.rule_id)
         AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.account_id = d.account_id AND f.message_id = d.message_id)
         AND EXISTS (SELECT 1 FROM decisions p WHERE p.account_id = d.account_id AND p.message_id = d.message_id AND p.id < d.id)`,
    )
    .all(accountId) as unknown as Pick<Suggestion, 'decisionId' | 'messageId'>[];
  const waiting = new Map([...pendingSuggestions(db, { accountId }), ...orphaned].map((s) => [s.messageId, s.decisionId] as const));

  let recorded = 0;
  for (const [messageId, decisionId] of waiting) {
    const facts = getFacts(db, accountId, messageId);
    const current = standing.get(decisionId) as unknown as Standing | undefined;
    if (!facts || !current) continue;

    let next: Decision | null = null;
    const ruled = await rules.decide(facts);
    if (ruled) {
      const learned = stored.find((r) => r.id === ruled.ruleId)?.learned ?? false;
      if (!learned || !same(current, ruled)) next = ruled;
    } else {
      const base = current.stage === 'rules' ? (judged.get(accountId, messageId) as unknown as Standing | undefined) : current;
      const label = labels.find((l) => l.id === base?.label_id);
      if (base && label) {
        const outcome = labelled(label);
        // Unknown counts as written to, unless the earlier decision hid the mail: the sender was checked then.
        const known = written(facts.from.address);
        const safe = known === false || (known === undefined && hides(base.disposition));
        const held = hides(outcome.disposition) && !safe;
        const before = base.reason.replace(/^.* Before: /, '');
        const derived: Decision = {
          ...(held ? { disposition: 'review', subscription: 'preserve', labelId: label.id, gmailLabel: label.gmailLabel } : outcome),
          stage: base.stage,
          ...(base.confidence === null ? {} : { confidence: base.confidence }),
          reason: held
            ? `${label.name} is now ${WILL[outcome.disposition]}, but ${known ? 'you have written to this sender' : 'whether you have written to this sender is not known'}. Before: ${before}`
            : `${label.name} is now ${WILL[outcome.disposition]}. Before: ${before}`,
        };
        const changed = !same(base, derived);
        if (current.stage === 'rules' || changed) next = changed ? derived : { ...derived, reason: base.reason };
      } else if (current.stage === 'rules') {
        next = { disposition: 'review', subscription: 'preserve', stage: 'fallback', reason: 'the rule that decided this no longer applies' };
      }
    }
    if (!next) continue;
    recordDecision(db, accountId, messageId, next, { mode: 'observe', now });
    if (next.ruleId) countRuleHit(db, next.ruleId);
    recorded++;
  }
  return recorded;
}

/**
 * Waiting suggestions the guidelines could change: ones a model judged, or no tier could place, before
 * `since` (when the guidelines last changed). Oldest first. Judging them again costs a model call each,
 * so it only happens when the user asks.
 */
export function predatingGuidelines(db: DatabaseSync, since: number, accountId?: string): Suggestion[] {
  return pendingSuggestions(db, accountId === undefined ? {} : { accountId })
    .filter((s) => s.stage !== 'rules' && s.decidedAt < since)
    .toReversed();
}
