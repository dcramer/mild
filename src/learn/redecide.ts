import { alias, and, decisions, desc, eq, exists, feedback, lt, max, ne, notExists, isNotNull, rules as ruleRows, sql } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import { recordDecision } from '../store/decisions.ts';
import { listLabels } from '../store/labels.ts';
import { getFacts } from '../store/messages.ts';
import { countRuleHit, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import { rulesStage } from '../triage/stages/rules.ts';
import { type Decision, type Disposition, labelled } from '../triage/types.ts';
import { type Suggestion, pendingSuggestions } from './feedback.ts';

const STANDING = {
  id: decisions.id,
  stage: decisions.stage,
  disposition: decisions.disposition,
  subscription: decisions.subscription,
  labelId: decisions.labelId,
  block: decisions.block,
  markRead: decisions.markRead,
  confidence: decisions.confidence,
  reason: decisions.reason,
};

const x = alias(decisions, 'x');
const p = alias(decisions, 'p');
const WILL: Record<Disposition, string> = { keep: 'kept', archive: 'archived', spam: 'marked as spam', review: 'left for you' };
const hides = (disposition: Disposition) => disposition === 'archive' || disposition === 'spam';

const same = (standing: { disposition: Disposition; labelId: string | null; subscription: string; block: boolean; markRead: boolean }, next: Decision) =>
  standing.disposition === next.disposition &&
  standing.labelId === (next.labelId ?? null) &&
  standing.subscription === next.subscription &&
  standing.block === (next.block ?? false) &&
  standing.markRead === (next.markRead ?? false);

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
export async function redecideWaiting(db: Sql, accountId: string, now: number = Date.now()): Promise<number> {
  const labels = await listLabels(db, accountId, now);
  const stored = await listRules(db, accountId);
  let known: boolean | undefined;
  const rules = rulesStage(stored, labels, { hasWritten: () => known });
  // Decided by a rule that no longer exists, after another tier had already decided it, and never answered.
  const orphaned: Pick<Suggestion, 'decisionId' | 'messageId'>[] = await db
    .select({ decisionId: decisions.id, messageId: decisions.messageId })
    .from(decisions)
    .where(
      and(
        eq(decisions.accountId, accountId),
        eq(decisions.mode, 'observe'),
        eq(decisions.stage, 'rules'),
        isNotNull(decisions.ruleId),
        eq(
          decisions.id,
          db
            .select({ id: max(x.id) })
            .from(x)
            .where(and(eq(x.accountId, decisions.accountId), eq(x.messageId, decisions.messageId))),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(ruleRows)
            .where(eq(ruleRows.id, decisions.ruleId)),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(feedback)
            .where(and(eq(feedback.accountId, decisions.accountId), eq(feedback.messageId, decisions.messageId))),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(p)
            .where(and(eq(p.accountId, decisions.accountId), eq(p.messageId, decisions.messageId), lt(p.id, decisions.id))),
        ),
      ),
    );
  const waiting = new Map([...(await pendingSuggestions(db, { accountId })), ...orphaned].map((s) => [s.messageId, s.decisionId] as const));

  let recorded = 0;
  for (const [messageId, decisionId] of waiting) {
    const facts = await getFacts(db, accountId, messageId);
    const [current] = await db.select(STANDING).from(decisions).where(eq(decisions.id, decisionId));
    if (!facts || !current) continue;
    known = await cachedCorrespondent(db, accountId, facts.from.address, now);

    let next: Decision | null = null;
    const ruled = await rules.decide(facts);
    if (ruled) {
      const learned = stored.find((r) => r.id === ruled.ruleId)?.learned ?? false;
      if (!learned || !same(current, ruled)) next = ruled;
    } else {
      const base =
        current.stage === 'rules'
          ? (
              await db
                .select(STANDING)
                .from(decisions)
                .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId), ne(decisions.stage, 'rules')))
                .orderBy(desc(decisions.id))
                .limit(1)
            )[0]
          : current;
      const label = labels.find((l) => l.id === base?.labelId);
      if (base && label) {
        const outcome = labelled(label);
        // Unknown counts as written to, unless the earlier decision hid the mail: the sender was checked then.
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
    await recordDecision(db, accountId, messageId, next, { mode: 'observe', now });
    if (next.ruleId) await countRuleHit(db, next.ruleId);
    recorded++;
  }
  return recorded;
}

/**
 * Waiting suggestions the guidelines could change: ones a model judged, or no tier could place, before
 * `since` (when the guidelines last changed). Oldest first. Judging them again costs a model call each,
 * so it only happens when the user asks.
 */
export async function predatingGuidelines(db: Sql, since: number, accountId?: string): Promise<Suggestion[]> {
  return (await pendingSuggestions(db, accountId === undefined ? {} : { accountId })).filter((s) => s.stage !== 'rules' && s.decidedAt < since).toReversed();
}
