import { alias, and, decisions, desc, eq, exists, feedback, lt, max, ne, notExists, isNotNull, isNull, rules as ruleRows, sql } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import { openEnvelope } from '../store/content.ts';
import { recordDecision } from '../store/decisions.ts';
import { listLabels } from '../store/labels.ts';
import { getFacts } from '../store/messages.ts';
import { countRuleHit, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import { SURE } from '../triage/stages/model.ts';
import { rulesStage, settle } from '../triage/stages/rules.ts';
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
  runId: decisions.runId,
  ruleId: decisions.ruleId,
};

const x = alias(decisions, 'x');
const p = alias(decisions, 'p');
const answeredDecision = alias(decisions, 'answered');
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
 * - no rule does by itself, and its label now has a different outcome, or a rule waiting for that label now
 *   says what happens: the same label is recorded with the new outcome. The label is still the tier's
 *   word; only what follows from it is worked out again;
 * - the rule that decided it has gone: it goes back to what a tier said before the rule, or to review.
 *
 * Mail a rule decided only because of an earlier call here is included, so removing that rule brings
 * the suggestion back. Mail the user answered for is never touched, including while this runs: it is one
 * transaction, and each message is checked again just before its decision is recorded. Returns how many
 * decisions were recorded.
 */
export async function redecideWaiting(db: Sql, accountId: string, now: number = Date.now()): Promise<number> {
  return await db.transaction(async (tx) => await redecide(tx, accountId, now));
}

/**
 * Whether `decisionId` still stands for its message and is unanswered. Its row is locked first, so an
 * answer to it (whose feedback row refers to it) waits until this transaction is done, or is seen here.
 */
async function stillWaiting(db: Sql, accountId: string, messageId: string, decisionId: number): Promise<boolean> {
  await db.select({ id: decisions.id }).from(decisions).where(eq(decisions.id, decisionId)).for('update');
  const [latest] = await db
    .select({ id: max(decisions.id) })
    .from(decisions)
    .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId)));
  if (latest?.id !== decisionId) return false;
  const answered = await db.select({ id: feedback.id }).from(feedback).where(eq(feedback.decisionId, decisionId)).limit(1);
  return answered.length === 0;
}

async function redecide(db: Sql, accountId: string, now: number): Promise<number> {
  const labels = await listLabels(db);
  const stored = await listRules(db);
  let known: boolean | undefined;
  const rules = rulesStage(stored, labels, { hasWritten: () => known });
  // Decided by a rule that no longer exists, after another tier had already decided it, and never answered.
  const orphaned: Pick<Suggestion, 'decisionId' | 'messageId'>[] = await db
    .select({ decisionId: decisions.id, messageId: decisions.messageId })
    .from(decisions)
    .where(
      and(
        eq(decisions.accountId, accountId),
        eq(decisions.carryOut, false),
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
            .innerJoin(answeredDecision, eq(answeredDecision.id, feedback.decisionId))
            .where(and(eq(answeredDecision.accountId, decisions.accountId), eq(answeredDecision.messageId, decisions.messageId))),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(p)
            .where(and(eq(p.accountId, decisions.accountId), eq(p.messageId, decisions.messageId), lt(p.id, decisions.id))),
        ),
      ),
    );
  // Mail Sift marked for review in Gmail while on is the user's to answer; a rule or label changing leaves it there.
  const suggested = (await pendingSuggestions(db, { accountId })).filter((s) => !s.carriedOut);
  const waiting = new Map([...suggested, ...orphaned].map((s) => [s.messageId, s.decisionId] as const));

  let recorded = 0;
  for (const [messageId, decisionId] of waiting) {
    const facts = await getFacts(db, accountId, messageId);
    const [standing] = await db.select(STANDING).from(decisions).where(eq(decisions.id, decisionId));
    if (!facts || !standing) continue;
    const current = openEnvelope(db, accountId, messageId, standing);
    known = await cachedCorrespondent(db, accountId, facts.from.address, now);

    let next: Decision | null = null;
    // What a model decided, worked out again, is still that call's.
    let runId: number | null = null;
    const ruled = await rules.decide(facts);
    if (ruled) {
      const learned = stored.find((r) => r.id === ruled.ruleId)?.learned ?? false;
      if (!learned || !same(current, ruled)) next = ruled;
    } else {
      // What the tier said before any rule had a hand in it.
      const fromRule = current.stage === 'rules' || current.ruleId !== null;
      const base = fromRule
        ? (
            await db
              .select(STANDING)
              .from(decisions)
              .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId), ne(decisions.stage, 'rules'), isNull(decisions.ruleId)))
              .orderBy(desc(decisions.id))
              .limit(1)
          ).map((r) => openEnvelope(db, accountId, messageId, r))[0]
        : current;
      const label = labels.find((l) => l.id === base?.labelId);
      if (base && label) {
        const before = base.reason.replace(/^.* Before: /, '');
        // A rule that waits for this label says what happens to it, as it would have when the tier gave it.
        const outcome = settle(stored, labels, facts, { ...labelled(label), stage: base.stage, reason: before }, { hasWritten: () => known });
        // Unknown counts as written to, unless the earlier decision hid the mail: the sender was checked then.
        const safe = known === false || (known === undefined && hides(base.disposition));
        // A model's label alone is carried out only when it was sure, as when it was given; a rule of the user's has no bar.
        // Held then, it was held already and nothing new is recorded, unless it was decided before the bar.
        const unsure = base.stage === 'model' && (base.confidence ?? 0) < SURE && !outcome.ruleId;
        const held = unsure || (hides(outcome.disposition) && !safe);
        const derived: Decision = {
          ...(held
            ? { disposition: 'review', subscription: 'preserve', labelId: label.id, ...(label.gmailLabel ? { gmailLabel: label.gmailLabel } : {}) }
            : outcome),
          stage: base.stage,
          ...(base.confidence === null ? {} : { confidence: base.confidence }),
          reason: held
            ? `${label.name} is now ${WILL[outcome.disposition]}, but ${unsure ? 'Sift was not sure enough to act on it' : known ? 'you have written to this sender' : 'whether you have written to this sender is not known'}. Before: ${before}`
            : outcome.ruleId
              ? outcome.reason
              : `${label.name} is now ${WILL[outcome.disposition]}. Before: ${before}`,
        };
        const changed = !same(base, derived) || derived.ruleId !== undefined;
        if (fromRule || changed) next = changed ? derived : { ...derived, reason: base.reason };
        runId = base.runId;
      } else if (base?.labelId) {
        // Labels are never deleted, so one not found here was removed.
        next = { disposition: 'review', subscription: 'preserve', stage: 'fallback', reason: 'the label it was given has been removed' };
      } else if (fromRule) {
        next = { disposition: 'review', subscription: 'preserve', stage: 'fallback', reason: 'the rule that decided this no longer applies' };
      }
    }
    if (!next || !(await stillWaiting(db, accountId, messageId, decisionId))) continue;
    await recordDecision(db, accountId, messageId, next, { now, ...(runId === null ? {} : { runId }) });
    if (next.ruleId) await countRuleHit(db, next.ruleId);
    recorded++;
  }
  return recorded;
}
