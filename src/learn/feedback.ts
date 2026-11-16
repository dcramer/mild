import {
  type SQL,
  type VERDICTS,
  alias,
  and,
  asc,
  count,
  decisions,
  desc,
  eq,
  examples,
  feedback,
  gte,
  inArray,
  isNotNull,
  labels,
  max,
  messages,
  min,
  ne,
  not,
  notExists,
  rules,
  sql,
  suggestionBodies,
} from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import { listLabels } from '../store/labels.ts';
import { recordDecision } from '../store/decisions.ts';
import { proposeFromAnswers } from '../store/proposals.ts';
import { type RuleSays, setRule } from '../store/rules.ts';
import type { RuleMatch } from '../triage/stages/rules.ts';
import type { RuleFacts } from '../triage/facts.ts';
import { factsWhere } from '../store/messages.ts';
import { type DecidedDisposition, type Decision, type Disposition, type StageName, type SubscriptionAction, labelled } from '../triage/types.ts';

/** A decision sift only suggested, that the user has not yet confirmed or corrected. */
export interface Suggestion {
  decisionId: number;
  accountId: string;
  messageId: string;
  stage: StageName;
  disposition: Disposition;
  /** With `spam`: sift would also block the sender. */
  block: boolean;
  /** sift would also unsubscribe. */
  unsubscribe: boolean;
  /** The label sift gave it, or null if it could not place it. */
  labelId: string | null;
  reason: string;
  confidence: number | null;
  decidedAt: number;
  receivedAt: number;
  fromAddress: string;
  fromName: string | null;
  subject: string;
}

const x = alias(decisions, 'x');

const SUGGESTION = {
  decisionId: decisions.id,
  accountId: decisions.accountId,
  messageId: decisions.messageId,
  stage: decisions.stage,
  disposition: decisions.disposition,
  block: decisions.block,
  subscription: decisions.subscription,
  labelId: decisions.labelId,
  reason: decisions.reason,
  confidence: decisions.confidence,
  decidedAt: decisions.decidedAt,
  receivedAt: messages.receivedAt,
  fromAddress: messages.fromAddress,
  fromName: messages.fromName,
  subject: messages.subject,
};

const toSuggestion = ({ subscription, ...r }: Omit<Suggestion, 'unsubscribe'> & { subscription: SubscriptionAction }): Suggestion => ({
  ...r,
  unsubscribe: subscription === 'unsubscribe',
});

/**
 * Suggestions waiting on the user, newest first: the current decision for a message, recorded as
 * a suggestion, with no answer yet. Decisions that only repeat what the user already told sift (their
 * answers, and rules they wrote or made by correcting it) are not suggestions and are left out; ones
 * from a rule sift learned are.
 */
export async function pendingSuggestions(
  db: Sql,
  filter: { accountId?: string; accounts?: readonly string[]; sender?: string; domain?: string; facts?: RuleFacts; limit?: number } = {},
): Promise<Suggestion[]> {
  const rows = await db
    .select(SUGGESTION)
    .from(decisions)
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .leftJoin(rules, eq(rules.id, decisions.ruleId))
    .where(
      and(
        eq(
          decisions.id,
          db
            .select({ id: max(x.id) })
            .from(x)
            .where(and(eq(x.accountId, decisions.accountId), eq(x.messageId, decisions.messageId))),
        ),
        eq(decisions.carryOut, false),
        eq(decisions.byUser, false),
        notExists(
          db
            .select({ one: sql`1` })
            .from(feedback)
            .where(eq(feedback.decisionId, decisions.id)),
        ),
        not(and(isNotNull(decisions.ruleId), ne(sql`coalesce(${rules.source}, 'user')`, 'learned'))!),
        filter.accounts === undefined ? undefined : inArray(decisions.accountId, filter.accounts),
        filter.accountId === undefined ? undefined : eq(decisions.accountId, filter.accountId),
        filter.sender === undefined ? undefined : eq(messages.fromAddress, filter.sender),
        filter.domain === undefined ? undefined : eq(messages.fromDomain, filter.domain),
        filter.facts === undefined ? undefined : factsWhere(filter.facts),
      ),
    )
    .orderBy(desc(decisions.decidedAt), desc(decisions.id))
    .limit(filter.limit ?? 5000);
  return rows.map(toSuggestion);
}

/** How far an answer reaches, which is also what kind of rule it makes. `once` makes none. */
type FeedbackScope =
  /** Mail from the sender that is this label: a rule that waits for the label. What "agree" means. */
  | 'label'
  /** Everything from the sender, whatever it is: a rule that only says what happens. */
  | 'sender'
  /** Everything from anyone at the sender's domain, likewise. */
  | 'domain'
  /** Mail from the sender whose subject contains `contains`, likewise. */
  | 'subject'
  /** Only the mail that is waiting (or the one decision given). No rule: the answer is kept as an example for the model. */
  | 'once';

/** A message sift never decided (the model could not judge it), with who sent it, or null. */
async function undecided(db: Sql, accountId: string, messageId: string): Promise<{ fromAddress: string } | null> {
  const [row] = await db
    .select({ fromAddress: messages.fromAddress })
    .from(messages)
    .where(
      and(
        eq(messages.accountId, accountId),
        eq(messages.id, messageId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(decisions)
            .where(and(eq(decisions.accountId, messages.accountId), eq(decisions.messageId, messages.id))),
        ),
      ),
    );
  return row ?? null;
}

/** The decision that currently stands for a message, in the shape of a suggestion, or null if it has none. */
async function currentDecision(db: Sql, accountId: string, messageId: string): Promise<Suggestion | null> {
  const [row] = await db
    .select(SUGGESTION)
    .from(decisions)
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId)))
    .orderBy(desc(decisions.id))
    .limit(1);
  return row ? toSuggestion(row) : null;
}

export interface FeedbackInput {
  accountId: string;
  sender: string;
  /** What the mail is: a label's id. Left out when the user says only what should happen to it. */
  label?: string;
  /** What should happen to it. Left out: what the label does. */
  disposition?: DecidedDisposition;
  /** Also unsubscribe from this mail. Carried by the rule. */
  unsubscribe?: boolean;
  scope: FeedbackScope;
  /** A condition in plain language that narrows a rule for the sender. Only a model can apply it, and it needs `label`. */
  when?: string;
  /** For `subject`: the words the subject must contain. */
  contains?: string;
  /** For `once`: answer for this one decision instead of everything waiting from the sender. */
  decisionId?: number;
  /**
   * The message the answer was given on. It need not be waiting: this is how a decision sift already
   * made, or mail it kept, is corrected, and how mail the model could not judge is answered. Either gets
   * a new decision.
   */
  messageId?: string;
  /**
   * Each message the answer settles gets it as a decision of its own, carried out in Gmail on the next
   * pass even while sift is off. Without it (an answer read from Gmail, where the mail already is) only
   * the corrected message's decision is recorded, and nothing is carried out.
   */
  carryOut?: boolean;
  /** Where the answer was given. Default: the dashboard. */
  via?: 'dashboard' | 'gmail';
}

interface FeedbackResult {
  /** Suggestions this answer settled. */
  reviewed: number;
  /** What sift will do differently from now on, in a sentence. Null if nothing lasting was learned. */
  taught: string | null;
  /** The message whose earlier decision was replaced, so the caller can put it right in the mailbox. */
  corrected: string | null;
  /** How many messages now have the answer waiting to be carried out in Gmail. */
  carrying: number;
  /** sift proposed a rule because the sender's mail has been answered the same way enough times. */
  proposed: boolean;
}

const WILL: Record<Disposition, string> = { keep: 'kept in your inbox', archive: 'archived', spam: 'marked as spam', review: 'left for you' };
const DO: Record<DecidedDisposition, string> = { keep: 'keep it', archive: 'archive it', spam: 'mark it as spam' };

/**
 * Record the user's answer about a sender's mail and make the rule its scope calls for:
 *
 * - `label`: mail from the sender that is this label gets this action. sift still reads each message.
 * - `sender`, `domain`, `subject`: that mail gets this action whatever it is, with no model.
 * - `once`: no rule. Saying only what a message is teaches the model through the example, and ties
 *   nothing to the sender.
 *
 * Throws if the label does not exist, the answer says neither what the mail is nor what should happen,
 * or it refers to nothing that is waiting.
 */
export async function applyFeedback(db: Sql, input: FeedbackInput, now: number = Date.now()): Promise<FeedbackResult> {
  const labels = await listLabels(db, input.accountId);
  const label = input.label === undefined ? undefined : labels.find((l) => l.id === input.label);
  if (input.label !== undefined && !label) throw new Error(`There is no label "${input.label}".`);
  const outcome = input.disposition ?? label?.disposition;
  if (outcome === undefined) throw new Error('Say what this is, or what should happen to it.');
  // A label set to "leave it for me" keeps the mail in the inbox.
  const wanted: DecidedDisposition = outcome === 'review' ? 'keep' : outcome;

  const contains = input.contains?.trim() ?? '';
  const when = input.when?.trim() ?? '';
  if (input.scope === 'subject' && contains === '') throw new Error('Say which words the subject must contain.');
  if ((input.scope === 'label' || when !== '') && !label) throw new Error('Say what kind of mail this is for.');
  const domain = input.sender.split('@')[1] ?? '';
  const waiting = await pendingSuggestions(db, { accountId: input.accountId, ...(input.scope === 'domain' ? { domain } : { sender: input.sender }) });
  const targets = waiting.filter((s) =>
    input.scope === 'subject'
      ? s.subject.toLowerCase().includes(contains.toLowerCase())
      : input.scope === 'label'
        ? s.labelId === label?.id
        : input.scope === 'once' && input.decisionId !== undefined
          ? s.decisionId === input.decisionId
          : true,
  );
  // A message that is not waiting (sift already acted on it, a rule decided it, or it was answered before)
  // is corrected through its current decision.
  const given =
    input.messageId !== undefined && !targets.some((t) => t.messageId === input.messageId) ? await currentDecision(db, input.accountId, input.messageId) : null;
  // Mail sift never decided has nothing to correct: the answer is its first decision, with no suggestion before it.
  const fresh =
    input.messageId !== undefined && !given && !targets.some((t) => t.messageId === input.messageId)
      ? await undecided(db, input.accountId, input.messageId)
      : null;
  const from = given?.fromAddress ?? fresh?.fromAddress;
  if (from !== undefined && from !== input.sender) throw new Error('That message is not from that sender.');
  if (targets.length === 0 && !given && !fresh)
    throw new Error(
      input.scope === 'subject' ? `Nothing waiting from ${input.sender} has "${contains}" in the subject.` : 'That suggestion is no longer waiting.',
    );
  const match: RuleMatch | null =
    input.scope === 'sender' || input.scope === 'label'
      ? { from: input.sender }
      : input.scope === 'domain'
        ? { fromDomain: domain }
        : input.scope === 'subject'
          ? { from: input.sender, subjectContains: contains }
          : null;
  const whose =
    input.scope === 'domain'
      ? `mail from anyone at ${domain}`
      : input.scope === 'subject'
        ? `mail from ${input.sender} with "${contains}" in the subject`
        : `mail from ${input.sender}`;
  const extra = input.unsubscribe ? { subscription: 'unsubscribe' as const } : {};
  // What the rule says, by how far the answer reaches.
  const says: RuleSays | null = !match
    ? null
    : when !== '' && label
      ? { labelId: label.id, when, ...(input.disposition ? { disposition: input.disposition } : {}), ...extra }
      : input.scope === 'label' && label
        ? { whenLabel: label.id, ...(input.disposition && input.disposition !== label.disposition ? { disposition: input.disposition } : {}), ...extra }
        : { disposition: wanted, ...extra };

  // The label a corrected message ends with: the one given, else the one it had.
  const standing = (target: Pick<Suggestion, 'labelId'>) => label ?? labels.find((l) => l.id === target.labelId);
  // Agreeing with a decision that already stands changes nothing about the message itself.
  const changes = given !== null && ((label !== undefined && given.labelId !== label.id) || given.disposition !== outcome);

  // sift having no suggestion is not sift being wrong. Otherwise it was right if it gave the same label,
  // or, when the user said only what should happen, if it would have done the same.
  const verdictFor = (target: Pick<Suggestion, 'labelId' | 'disposition'>): (typeof VERDICTS)[number] =>
    target.labelId === null ? 'answered' : (label ? target.labelId === label.id : target.disposition === wanted) ? 'right' : 'wrong';
  await db.transaction(async (tx) => {
    const settled: Pick<Suggestion, 'accountId' | 'decisionId' | 'messageId' | 'labelId' | 'disposition'>[] = given ? [...targets, given] : [...targets];
    const ruleId =
      match && says
        ? await setRule(tx, input.accountId, match, says, !fresh && settled.every((t) => verdictFor(t) === 'right') ? 'user' : 'correction', now)
        : null;
    // Pressed in the dashboard: what the user said is done to each waiting message it settled.
    const answer = (target: Pick<Suggestion, 'labelId'>): Decision => {
      const is = standing(target);
      return {
        ...(is ? labelled(is, wanted === is.disposition ? undefined : wanted) : { disposition: wanted, subscription: 'preserve' as const }),
        ...extra,
        stage: 'rules',
        ...(ruleId ? { ruleId } : {}),
        reason: label ? `you said this is ${label.name}` : `you said to ${DO[wanted]}`,
      };
    };
    const carried = { carryOut: input.carryOut ?? false, byUser: true, now };
    if (fresh && input.messageId !== undefined) {
      const decisionId = await recordDecision(tx, input.accountId, input.messageId, answer({ labelId: null }), carried);
      settled.push({ accountId: input.accountId, decisionId, messageId: input.messageId, labelId: null, disposition: 'review' });
    }
    for (const target of settled) {
      const is = standing(target)?.id ?? null;
      const answered = { verdict: verdictFor(target), disposition: wanted, labelId: is, via: input.via ?? 'dashboard', createdAt: now };
      await tx
        .insert(feedback)
        .values({ accountId: target.accountId, decisionId: target.decisionId, ...answered })
        .onConflictDoUpdate({ target: [feedback.userId, feedback.decisionId], set: answered });
      // Every marked message is kept whole as an example; `sift run` fetches it on its next pass.
      await tx
        .insert(examples)
        .values({ accountId: target.accountId, messageId: target.messageId, disposition: wanted, labelId: is, markedAt: now })
        .onConflictDoUpdate({ target: [examples.userId, examples.accountId, examples.messageId], set: { disposition: wanted, labelId: is, markedAt: now } });
      // Its text was kept only while it waited on the user.
      await tx.delete(suggestionBodies).where(and(eq(suggestionBodies.accountId, target.accountId), eq(suggestionBodies.messageId, target.messageId)));
    }
    if (input.carryOut) for (const target of targets) await recordDecision(tx, input.accountId, target.messageId, answer(target), carried);
    // The corrected message gets a decision of its own, so the log shows what the user said and, when
    // it is carried out, the mailbox is brought into line with it.
    if (given && changes) await recordDecision(tx, input.accountId, given.messageId, answer(given), carried);
  });
  const unsubscribed = (fromLabel: boolean) => ((fromLabel && label?.unsubscribe) || input.unsubscribe ? ', and unsubscribed from' : '');
  // An answer makes no rule of its own; enough of the same answers for a sender, and sift offers one.
  const proposed = !match && label !== undefined && (await proposeFromAnswers(db, input.accountId, input.sender, now));
  return {
    reviewed: targets.length + (given || fresh ? 1 : 0),
    corrected: given && changes ? given.messageId : null,
    carrying: input.carryOut ? targets.length + ((given && changes) || fresh ? 1 : 0) : 0,
    proposed,
    taught: !says
      ? null
      : says.when && label
        ? `From now on, ${whose}, when it is ${when}, is ${label.name}: ${WILL[outcome]}${unsubscribed(true)}. sift reads each one to tell.`
        : says.whenLabel && label
          ? `From now on, mail from ${input.sender} that is ${label.name} is ${WILL[outcome]}${unsubscribed(true)}. sift still reads each message, and asks about anything else from them.`
          : `From now on, ${whose} is ${WILL[wanted]}${unsubscribed(false)}, whatever it is. sift will not ask about it again.`,
  };
}

export interface Accuracy {
  reviewed: number;
  right: number;
  /** Per tier that made the suggestion. Tiers with no answers are absent. */
  byStage: { stage: StageName; reviewed: number; right: number }[];
  /** Per label sift gave, most answers first. */
  byLabel: { labelId: string; labelName: string; reviewed: number; right: number }[];
  /** What sift called one label when the user said another, commonest first. */
  confusion: { suggested: string; correct: string; count: number }[];
}

/**
 * How often sift's suggestions matched what the user wanted, from the answers given since `since`.
 * An answer to mail sift could not place is not counted: having no suggestion is not being wrong.
 */
export async function accuracy(db: Sql, since = 0, accounts?: readonly string[]): Promise<Accuracy> {
  const right = sql<number>`count(*) FILTER (WHERE ${feedback.verdict} = 'right')`.mapWith(Number);
  const scored = (...also: SQL[]) =>
    and(
      inArray(feedback.verdict, ['right', 'wrong']),
      gte(feedback.createdAt, since),
      // Given, only these accounts' answers count; none given means none count.
      accounts === undefined ? undefined : inArray(feedback.accountId, accounts),
      ...also,
    );
  const byStage = await db
    .select({ stage: decisions.stage, reviewed: count(), right })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .where(scored())
    .groupBy(decisions.stage)
    .orderBy(asc(decisions.stage));
  // Each mailbox names its own labels; across several, the same id shows one of its names.
  const byLabel = (await db
    .select({ labelId: decisions.labelId, labelName: min(labels.name), reviewed: count(), right })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .innerJoin(labels, and(eq(labels.accountId, decisions.accountId), eq(labels.id, decisions.labelId)))
    .where(scored())
    .groupBy(decisions.labelId)
    .orderBy(desc(count()), asc(decisions.labelId))) as { labelId: string; labelName: string; reviewed: number; right: number }[];
  const confusion = (await db
    .select({ suggested: decisions.labelId, correct: feedback.labelId, count: count() })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .where(scored(eq(feedback.verdict, 'wrong'), isNotNull(decisions.labelId), isNotNull(feedback.labelId)))
    .groupBy(decisions.labelId, feedback.labelId)
    .orderBy(desc(count()), asc(decisions.labelId), asc(feedback.labelId))) as { suggested: string; correct: string; count: number }[];
  return {
    reviewed: byStage.reduce((sum, r) => sum + r.reviewed, 0),
    right: byStage.reduce((sum, r) => sum + r.right, 0),
    byStage,
    byLabel,
    confusion,
  };
}
