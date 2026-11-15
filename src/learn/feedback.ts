import type { DatabaseSync } from 'node:sqlite';
import { listLabels } from '../store/labels.ts';
import { setSenderRule } from '../store/rules.ts';
import type { DecidedDisposition, Disposition, StageName } from '../triage/types.ts';

/** A decision sift made while only observing, that the user has not yet confirmed or corrected. */
export interface Suggestion {
  decisionId: number;
  accountId: string;
  messageId: string;
  stage: StageName;
  disposition: Disposition;
  /** The label sift gave it, or null if it could not place it. */
  labelId: string | null;
  reason: string;
  confidence: number | null;
  decidedAt: number;
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
  label_id: string | null;
  reason: string;
  confidence: number | null;
  decided_at: number;
  from_address: string;
  from_name: string | null;
  subject: string;
}

/**
 * Suggestions waiting on the user, newest first: the current decision for a message, made while
 * observing, with no answer yet. Decisions that only repeat what the user already told sift (rules they
 * wrote or made by correcting it) are not suggestions and are left out; ones from a rule sift learned are.
 */
export function pendingSuggestions(db: DatabaseSync, filter: { accountId?: string; sender?: string; limit?: number } = {}): Suggestion[] {
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
  const rows = db
    .prepare(
      `SELECT d.id, d.account_id, d.message_id, d.stage, d.disposition, d.label_id, d.reason, d.confidence, d.decided_at,
              m.from_address, m.from_name, m.subject
       FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       LEFT JOIN rules r ON r.id = d.rule_id
       WHERE d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
         AND d.mode = 'observe'
         AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.decision_id = d.id)
         AND NOT (d.stage = 'rules' AND coalesce(r.source, 'user') != 'agent')
         ${where.map((clause) => `AND ${clause}`).join(' ')}
       ORDER BY d.decided_at DESC, d.id DESC LIMIT ?`,
    )
    .all(...params, filter.limit ?? 5000) as unknown as Row[];
  return rows.map((r) => ({
    decisionId: r.id,
    accountId: r.account_id,
    messageId: r.message_id,
    stage: r.stage,
    disposition: r.disposition,
    labelId: r.label_id,
    reason: r.reason,
    confidence: r.confidence,
    decidedAt: r.decided_at,
    fromAddress: r.from_address,
    fromName: r.from_name,
    subject: r.subject,
  }));
}

export interface FeedbackInput {
  accountId: string;
  sender: string;
  /** What the mail is: a label's id. Confirming a suggestion sends the label sift gave it. */
  label: string;
  /** An exception to the label's action, for this sender only. */
  disposition?: DecidedDisposition;
  /** `sender`: this is what everything from the sender is. `message`: only the one decision. */
  scope: 'sender' | 'message';
  decisionId?: number;
}

export interface FeedbackResult {
  /** Suggestions this answer settled. */
  reviewed: number;
  /** What sift will do differently from now on, in a sentence. Null if nothing lasting was learned. */
  taught: string | null;
}

const WILL: Record<Disposition, string> = { keep: 'kept in your inbox', archive: 'archived', spam: 'marked as spam', review: 'left for you' };

/**
 * Record the user's answer to a suggestion and, for a sender-wide answer, make a rule for the sender
 * so their mail gets that label from now on without a model. Throws if the label does not exist or
 * the answer refers to nothing that is waiting.
 */
export function applyFeedback(db: DatabaseSync, input: FeedbackInput, now: number = Date.now()): FeedbackResult {
  const label = listLabels(db, input.accountId, now).find((l) => l.id === input.label);
  if (!label) throw new Error(`There is no label "${input.label}".`);
  const outcome = input.disposition ?? label.disposition;
  // A label set to "leave it for me" keeps the mail in the inbox.
  const wanted: DecidedDisposition = outcome === 'review' ? 'keep' : outcome;

  const waiting = pendingSuggestions(db, { accountId: input.accountId, sender: input.sender });
  const targets = input.scope === 'sender' ? waiting : waiting.filter((s) => s.decisionId === input.decisionId);
  if (targets.length === 0) throw new Error('That suggestion is no longer waiting.');

  const insert = db.prepare(
    'INSERT INTO feedback (account_id, decision_id, message_id, verdict, correct, scope, created_at, label_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  // Every marked message is kept whole as an example; `sift run` fetches it on its next pass.
  const example = db.prepare(
    `INSERT INTO examples (account_id, message_id, disposition, label_id, suggested, suggested_by, marked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account_id, message_id) DO UPDATE SET disposition = excluded.disposition, label_id = excluded.label_id, marked_at = excluded.marked_at`,
  );
  // sift having no suggestion is not sift being wrong; otherwise it was right if it gave the same label.
  const verdictFor = (target: Suggestion) => (target.labelId === null ? 'answered' : target.labelId === label.id ? 'right' : 'wrong');
  db.exec('BEGIN');
  try {
    for (const target of targets) {
      const verdict = verdictFor(target);
      insert.run(target.accountId, target.decisionId, target.messageId, verdict, verdict === 'right' ? null : wanted, input.scope, now, label.id);
      example.run(target.accountId, target.messageId, wanted, label.id, target.disposition, target.stage, now);
    }
    if (input.scope === 'sender') {
      setSenderRule(
        db,
        input.accountId,
        input.sender,
        { labelId: label.id, ...(input.disposition ? { disposition: input.disposition } : {}) },
        targets.every((t) => verdictFor(t) === 'right') ? 'user' : 'correction',
        now,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { reviewed: targets.length, taught: input.scope === 'sender' ? `From now on, mail from ${input.sender} is ${label.name}: ${WILL[outcome]}.` : null };
}

/** How often sift's suggestions matched what the user wanted, from their answers. */
export function accuracy(db: DatabaseSync): { reviewed: number; right: number; byStage: { stage: StageName; reviewed: number; right: number }[] } {
  const rows = db
    .prepare(
      `SELECT d.stage, count(*) AS reviewed, sum(f.verdict = 'right') AS right
       FROM feedback f JOIN decisions d ON d.id = f.decision_id
       WHERE f.verdict IN ('right', 'wrong') GROUP BY d.stage`,
    )
    .all() as unknown as { stage: StageName; reviewed: number; right: number }[];
  return { reviewed: rows.reduce((sum, r) => sum + r.reviewed, 0), right: rows.reduce((sum, r) => sum + r.right, 0), byStage: rows };
}
