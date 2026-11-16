import type { DatabaseSync } from 'node:sqlite';
import { listLabels } from '../store/labels.ts';
import { recordDecision } from '../store/decisions.ts';
import { type RuleSays, setRule } from '../store/rules.ts';
import type { RuleMatch } from '../triage/stages/rules.ts';
import { type DecidedDisposition, type Disposition, type StageName, labelled } from '../triage/types.ts';

/** A decision sift made while only observing, that the user has not yet confirmed or corrected. */
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

interface Row {
  id: number;
  account_id: string;
  message_id: string;
  stage: StageName;
  disposition: Disposition;
  block: number;
  subscription: string;
  label_id: string | null;
  reason: string;
  confidence: number | null;
  decided_at: number;
  received_at: number;
  from_address: string;
  from_name: string | null;
  subject: string;
}

const toSuggestion = (r: Row): Suggestion => ({
  decisionId: r.id,
  accountId: r.account_id,
  messageId: r.message_id,
  stage: r.stage,
  disposition: r.disposition,
  block: r.block === 1,
  unsubscribe: r.subscription === 'unsubscribe',
  labelId: r.label_id,
  reason: r.reason,
  confidence: r.confidence,
  decidedAt: r.decided_at,
  receivedAt: r.received_at,
  fromAddress: r.from_address,
  fromName: r.from_name,
  subject: r.subject,
});

/**
 * Suggestions waiting on the user, newest first: the current decision for a message, made while
 * observing, with no answer yet. Decisions that only repeat what the user already told sift (rules they
 * wrote or made by correcting it) are not suggestions and are left out; ones from a rule sift learned are.
 */
export function pendingSuggestions(db: DatabaseSync, filter: { accountId?: string; sender?: string; domain?: string; limit?: number } = {}): Suggestion[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.accountId !== undefined) {
    where.push('d.account_id = ?');
    params.push(filter.accountId);
  }
  if (filter.sender !== undefined) {
    where.push('m.from_address = ?');
    params.push(filter.sender);
  }
  if (filter.domain !== undefined) {
    where.push('m.from_domain = ?');
    params.push(filter.domain);
  }
  const rows = db
    .prepare(
      `SELECT d.id, d.account_id, d.message_id, d.stage, d.disposition, d.block, d.subscription, d.label_id, d.reason, d.confidence, d.decided_at,
              m.received_at, m.from_address, m.from_name, m.subject
       FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       LEFT JOIN rules r ON r.id = d.rule_id
       WHERE d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
         AND d.mode = 'observe'
         AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.decision_id = d.id)
         AND NOT ((d.stage = 'rules' OR d.rule_id IS NOT NULL) AND coalesce(r.source, 'user') != 'agent')
         ${where.map((clause) => `AND ${clause}`).join(' ')}
       ORDER BY d.decided_at DESC, d.id DESC LIMIT ?`,
    )
    .all(...params, filter.limit ?? 5000) as unknown as Row[];
  return rows.map(toSuggestion);
}

/** How far an answer reaches, which is also what kind of rule it makes. `once` makes none. */
export type FeedbackScope =
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

const SUGGESTION_COLUMNS = `d.id, d.account_id, d.message_id, d.stage, d.disposition, d.block, d.subscription, d.label_id, d.reason, d.confidence, d.decided_at,
              m.received_at, m.from_address, m.from_name, m.subject`;

/** The decision that currently stands for a message, in the shape of a suggestion, or null if it has none. */
function currentDecision(db: DatabaseSync, accountId: string, messageId: string): Suggestion | null {
  const row = db
    .prepare(
      `SELECT ${SUGGESTION_COLUMNS} FROM decisions d JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND d.message_id = ? ORDER BY d.id DESC LIMIT 1`,
    )
    .get(accountId, messageId) as unknown as Row | undefined;
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
   * made, or mail it kept, is corrected. A corrected message gets a new decision in `mode`.
   */
  messageId?: string;
  /** Whether sift is acting, which decides whether the corrected message's new decision is to be carried out. */
  mode?: 'act' | 'observe';
}

export interface FeedbackResult {
  /** Suggestions this answer settled. */
  reviewed: number;
  /** What sift will do differently from now on, in a sentence. Null if nothing lasting was learned. */
  taught: string | null;
  /** The message whose earlier decision was replaced, so the caller can put it right in the mailbox. */
  corrected: string | null;
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
export function applyFeedback(db: DatabaseSync, input: FeedbackInput, now: number = Date.now()): FeedbackResult {
  const labels = listLabels(db, input.accountId, now);
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
  const waiting = pendingSuggestions(db, { accountId: input.accountId, ...(input.scope === 'domain' ? { domain } : { sender: input.sender }) });
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
    input.messageId !== undefined && !targets.some((t) => t.messageId === input.messageId) ? currentDecision(db, input.accountId, input.messageId) : null;
  if (given && given.fromAddress !== input.sender) throw new Error('That message is not from that sender.');
  if (targets.length === 0 && !given)
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
  const standing = (target: Suggestion) => label ?? labels.find((l) => l.id === target.labelId);
  // Agreeing with a decision that already stands changes nothing about the message itself.
  const changes = given !== null && ((label !== undefined && given.labelId !== label.id) || given.disposition !== outcome);

  const insert = db.prepare(
    `INSERT INTO feedback (account_id, decision_id, message_id, verdict, correct, scope, created_at, label_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (decision_id) DO UPDATE
       SET verdict = excluded.verdict, correct = excluded.correct, scope = excluded.scope, created_at = excluded.created_at, label_id = excluded.label_id`,
  );
  // Every marked message is kept whole as an example; `sift run` fetches it on its next pass.
  const example = db.prepare(
    `INSERT INTO examples (account_id, message_id, disposition, label_id, suggested, suggested_by, marked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account_id, message_id) DO UPDATE SET disposition = excluded.disposition, label_id = excluded.label_id, marked_at = excluded.marked_at`,
  );
  // sift having no suggestion is not sift being wrong. Otherwise it was right if it gave the same label,
  // or, when the user said only what should happen, if it would have done the same.
  const verdictFor = (target: Suggestion) =>
    target.labelId === null ? 'answered' : (label ? target.labelId === label.id : target.disposition === wanted) ? 'right' : 'wrong';
  db.exec('BEGIN');
  try {
    const all = given ? [...targets, given] : targets;
    for (const target of all) {
      const verdict = verdictFor(target);
      const is = standing(target)?.id ?? null;
      insert.run(target.accountId, target.decisionId, target.messageId, verdict, verdict === 'right' ? null : wanted, match ? 'sender' : 'message', now, is);
      example.run(target.accountId, target.messageId, wanted, is, target.disposition, target.stage, now);
    }
    const ruleId = match && says ? setRule(db, input.accountId, match, says, all.every((t) => verdictFor(t) === 'right') ? 'user' : 'correction', now) : null;
    // The corrected message gets a decision of its own, so the log shows what the user said and, when
    // sift is acting, the mailbox is brought into line with it.
    if (given && changes) {
      const is = standing(given);
      recordDecision(
        db,
        input.accountId,
        given.messageId,
        {
          ...(is ? labelled(is, wanted === is.disposition ? undefined : wanted) : { disposition: wanted, subscription: 'preserve' as const }),
          ...extra,
          stage: 'rules',
          ...(ruleId ? { ruleId } : {}),
          reason: label ? `you said this is ${label.name}` : `you said to ${DO[wanted]}`,
        },
        { mode: input.mode ?? 'observe', now },
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const unsubscribed = (fromLabel: boolean) => ((fromLabel && label?.unsubscribe) || input.unsubscribe ? ', and unsubscribed from' : '');
  return {
    reviewed: targets.length + (given ? 1 : 0),
    corrected: given && changes ? given.messageId : null,
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
  /** Per label sift gave, most answers first. The name is null if the label has gone. */
  byLabel: { labelId: string; labelName: string | null; reviewed: number; right: number }[];
  /** What sift called one label when the user said another, commonest first. */
  confusion: { suggested: string; correct: string; count: number }[];
}

/**
 * How often sift's suggestions matched what the user wanted, from the answers given since `since`.
 * An answer to mail sift could not place is not counted: having no suggestion is not being wrong.
 */
export function accuracy(db: DatabaseSync, since = 0): Accuracy {
  const all = <T>(sql: string) => db.prepare(sql).all(since) as unknown as T[];
  const scored = `FROM feedback f JOIN decisions d ON d.id = f.decision_id WHERE f.verdict IN ('right', 'wrong') AND f.created_at >= ?`;
  const byStage = all<{ stage: StageName; reviewed: number; right: number }>(
    `SELECT d.stage, count(*) AS reviewed, sum(f.verdict = 'right') AS right ${scored} GROUP BY d.stage ORDER BY d.stage`,
  );
  const byLabel = all<{ label_id: string; name: string | null; reviewed: number; right: number }>(
    `SELECT d.label_id, (SELECT l.name FROM labels l WHERE l.account_id = d.account_id AND l.id = d.label_id) AS name,
            count(*) AS reviewed, sum(f.verdict = 'right') AS right
     ${scored} AND d.label_id IS NOT NULL GROUP BY d.label_id ORDER BY reviewed DESC, d.label_id`,
  );
  const confusion = all<{ suggested: string; correct: string; count: number }>(
    `SELECT d.label_id AS suggested, f.label_id AS correct, count(*) AS count
     ${scored} AND f.verdict = 'wrong' AND d.label_id IS NOT NULL AND f.label_id IS NOT NULL
     GROUP BY d.label_id, f.label_id ORDER BY count DESC, suggested, correct`,
  );
  return {
    reviewed: byStage.reduce((sum, r) => sum + r.reviewed, 0),
    right: byStage.reduce((sum, r) => sum + r.right, 0),
    byStage,
    byLabel: byLabel.map((r) => ({ labelId: r.label_id, labelName: r.name, reviewed: r.reviewed, right: r.right })),
    confusion,
  };
}
