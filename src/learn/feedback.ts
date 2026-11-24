import { type VERDICTS, and, decisions, desc, eq, examples, feedback, isNull, messages, not, notExists, sql } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import { exampleKeysOf, openEnvelope } from '../store/content.ts';
import { type Suggestion, currentSuggestion, pendingSuggestions } from '../store/suggestions.ts';
import { listLabels } from '../store/labels.ts';
import { ofMessage, recordDecision } from '../store/decisions.ts';
import { exampleText } from '../store/kept.ts';
import { proposeFromCorrections } from '../store/proposals.ts';
import { type DecidedDisposition, type Decision, LEAVE_IN_INBOX, labelled } from '../triage/types.ts';
import { Refusal } from '../refusal.ts';
import { plain } from '../plain.ts';

/** A message Mild never decided (the model could not judge it), with who sent it, or null. */
async function undecided(db: Sql, accountId: string, messageId: string): Promise<{ fromAddress: string } | null> {
  const [row] = await db
    .select({ headers: messages.headers })
    .from(messages)
    .where(
      and(
        eq(messages.accountId, accountId),
        eq(messages.id, messageId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(decisions)
            .where(ofMessage),
        ),
      ),
    );
  return row ? plain(openEnvelope(db, accountId, messageId, row)) : null;
}

/**
 * The newest decision for a message that is not one of the user's own answers (a rule they applied is still scored),
 * or null when there is none: what an answer is scored against, so picking again is never scored against the last pick.
 */
async function mildSaid(db: Sql, accountId: string, messageId: string): Promise<{ decisionId: number; labelId: string | null } | null> {
  const [row] = await db
    .select({ decisionId: decisions.id, labelId: decisions.labelId })
    .from(decisions)
    .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId), not(and(eq(decisions.byUser, true), isNull(decisions.ruleId))!)))
    .orderBy(desc(decisions.id))
    .limit(1);
  return row ?? null;
}

export interface FeedbackInput {
  accountId: string;
  sender: string;
  /** What the mail is: a label's id. */
  label: string;
  /** What should happen to it. Left out: what the label does. */
  disposition?: DecidedDisposition;
  /** The decision the answer was given on, when the message had one: an answer to one since replaced corrects the new one. */
  decisionId?: number;
  /**
   * The one message the answer is about; the sender's other waiting mail is left alone. It need not be
   * waiting: this is how a decision Mild already made, or mail it kept, is corrected, and how mail the
   * model could not judge is answered. Either gets a new decision.
   */
  messageId: string;
  /**
   * Each message the answer settles gets it as a decision of its own, carried out in Gmail on the next
   * pass even while Mild is off. Without it (an answer read from Gmail, where the mail already is) only
   * the corrected message's decision is recorded, and nothing is carried out.
   */
  carryOut?: boolean;
  /** Where the answer was given. Default: the dashboard. */
  via?: 'dashboard' | 'gmail';
}

interface FeedbackResult {
  /** The message whose earlier decision was replaced, so the caller can put it right in the mailbox. */
  corrected: string | null;
  /** How many messages now have the answer waiting to be carried out in Gmail. */
  carrying: number;
  /** Messages this answer settled that Mild had left for review while on, so the caller can take back a label it guessed, carried out or not. */
  asked: string[];
}

const DO: Record<DecidedDisposition, string> = { keep: 'keep it', archive: 'archive it', spam: 'mark it as spam' };

/**
 * Record the user's answer about what a message is. It makes no rule: the message is kept as an example
 * for the model, and nothing is tied to the sender until the user adds a rule in the rule dialog.
 *
 * Throws if the label does not exist, or the answer refers to nothing that is waiting.
 */
export async function applyFeedback(db: Sql, input: FeedbackInput, now: number = Date.now()): Promise<FeedbackResult> {
  const label = (await listLabels(db)).find((l) => l.id === input.label);
  if (!label) throw new Refusal(`There is no label "${input.label}".`);
  const outcome = input.disposition ?? label.disposition;
  if (label.id === LEAVE_IN_INBOX && outcome !== 'keep') throw new Refusal('Mail left in your inbox stays there. Choose the label for mail to move.');
  // A label set to "leave it for me" keeps the mail in the inbox.
  const wanted: DecidedDisposition = outcome === 'review' ? 'keep' : outcome;

  const waiting = await pendingSuggestions(db, { accountId: input.accountId, sender: input.sender });
  const targets = waiting.filter((s) => s.messageId === input.messageId && (input.decisionId === undefined || s.decisionId === input.decisionId));
  // A message that is not waiting (Mild already acted on it, a rule decided it, or it was answered before)
  // is corrected through its current decision.
  const given = targets.length === 0 ? await currentSuggestion(db, input.accountId, input.messageId) : null;
  // Mail Mild never decided has nothing to correct: the answer is its first decision, with no suggestion before it.
  const fresh = targets.length === 0 && !given ? await undecided(db, input.accountId, input.messageId) : null;
  const from = given?.fromAddress ?? fresh?.fromAddress;
  if (from !== undefined && from !== input.sender) throw new Refusal('That message is not from that sender.');
  if (targets.length === 0 && !given && !fresh) throw new Refusal('That message is no longer waiting for review.');
  // With only the user's own answers before it, there is nothing of Mild's to be right or wrong.
  const scored = given ? ((await mildSaid(db, input.accountId, given.messageId)) ?? { decisionId: given.decisionId, labelId: null }) : null;

  // Agreeing with a decision that already stands changes nothing about the message itself.
  const changes = given !== null && (given.labelId !== label.id || given.disposition !== outcome);
  // Unless it was only said, and is now to be done.
  const decides = given !== null && (changes || (input.carryOut === true && !given.carriedOut));
  // Mild having no suggestion is not Mild being wrong.
  const verdictFor = (target: Pick<Suggestion, 'labelId'>): (typeof VERDICTS)[number] =>
    target.labelId === null ? 'answered' : target.labelId === label.id ? 'right' : 'wrong';
  // Pressed in the dashboard: what the user said is done to each waiting message it settled.
  const answer: Decision = {
    ...labelled(label, wanted === label.disposition ? undefined : wanted),
    stage: 'rules',
    reason:
      label.id === LEAVE_IN_INBOX
        ? 'you said to leave it in your inbox'
        : input.disposition !== undefined && input.disposition !== label.disposition
          ? `you said this is ${label.name}, and to ${DO[wanted]}`
          : `you said this is ${label.name}`,
  };
  await db.transaction(async (tx) => {
    const settled: Pick<Suggestion, 'accountId' | 'decisionId' | 'messageId' | 'labelId'>[] =
      given && scored ? [...targets, { accountId: given.accountId, messageId: given.messageId, ...scored }] : [...targets];
    const carried = { carryOut: input.carryOut ?? false, byUser: true, now };
    if (fresh) {
      const decisionId = await recordDecision(tx, input.accountId, input.messageId, answer, carried);
      settled.push({ accountId: input.accountId, decisionId, messageId: input.messageId, labelId: null });
    }
    for (const target of settled) {
      const answered = { verdict: verdictFor(target), disposition: wanted, labelId: label.id, via: input.via ?? 'dashboard', createdAt: now };
      await tx
        .insert(feedback)
        .values({ accountId: target.accountId, decisionId: target.decisionId, ...answered })
        .onConflictDoUpdate({ target: [feedback.userId, feedback.decisionId], set: answered });
      // Every marked message is kept as an example, with the text Mild holds of it; without any, the next pass captures it.
      const kept = await exampleText(tx, target.accountId, target.messageId);
      const held = kept ? { status: 'captured' as const, ...kept } : {};
      const marked = { labelId: label.id, markedAt: now, ...held };
      await tx
        .insert(examples)
        .values({ accountId: target.accountId, messageId: target.messageId, ...marked, ...(await exampleKeysOf(tx, target.accountId, target.messageId)) })
        .onConflictDoUpdate({ target: [examples.userId, examples.accountId, examples.messageId], set: marked });
    }
    // Mail Mild already marked in Gmail gets the answer as a decision of its own however it was given, as a correction would.
    for (const target of targets) if (input.carryOut || target.carriedOut) await recordDecision(tx, input.accountId, target.messageId, answer, carried);
    // The corrected message gets a decision of its own, so the log shows what the user said and, when
    // it is carried out, the mailbox is brought into line with it.
    if (given && decides) await recordDecision(tx, input.accountId, given.messageId, answer, carried);
  });
  // An answer makes no rule of its own; enough answers giving a sender's mail of one label another action, and Mild offers one.
  await proposeFromCorrections(db, input.accountId, input.sender, label.id, now);
  return {
    corrected: given && changes ? given.messageId : null,
    carrying: input.carryOut ? targets.length + (decides || fresh ? 1 : 0) : 0,
    asked: targets.filter((t) => t.carriedOut).map((t) => t.messageId),
  };
}
