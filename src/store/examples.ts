import type { Sql } from './sql.ts';
import { MAX_SHOTS, type Shot, excerptOf } from '../triage/fewshot.ts';
import type { MessageFacts } from '../triage/types.ts';

interface ShotRow {
  message_id: string;
  from_address: string;
  from_domain: string;
  from_name: string | null;
  subject: string;
  start: string | null;
  label_id: string;
  marked_at: number;
}

/**
 * Stored examples that might help judge `facts`: the newest from its sender, from its sender's domain,
 * and of each label. More than the prompt takes; `pickShots` chooses among them.
 */
export async function shotCandidates(db: Sql, facts: Pick<MessageFacts, 'accountId' | 'from'>): Promise<Shot[]> {
  const select = `SELECT e.message_id, m.from_address, m.from_domain, m.from_name, m.subject, substr(e.body_text, 1, 2000) AS start, e.label_id, e.marked_at
     FROM examples e JOIN messages m ON m.account_id = e.account_id AND m.id = e.message_id
     WHERE e.account_id = ? AND e.status = 'captured' AND e.label_id IS NOT NULL`;
  const newest = 'ORDER BY e.marked_at DESC, e.message_id LIMIT ?';
  // One more than the prompt takes, so leaving out the message under judgement still fills it.
  const limit = MAX_SHOTS + 1;
  const rows = [
    ...(await db.all(`${select} AND m.from_address = ? ${newest}`, facts.accountId, facts.from.address, limit)),
    ...(await db.all(`${select} AND m.from_domain = ? ${newest}`, facts.accountId, facts.from.domain, limit)),
    ...(await db.all(
      `SELECT * FROM (SELECT x.*, row_number() OVER (PARTITION BY label_id ORDER BY marked_at DESC, message_id) AS nth FROM (${select}) x) WHERE nth <= 2`,
      facts.accountId,
    )),
  ] as unknown as ShotRow[];
  return [...new Map(rows.map((r) => [r.message_id, r] as const)).values()].map((r) => ({
    messageId: r.message_id,
    fromAddress: r.from_address,
    fromDomain: r.from_domain,
    ...(r.from_name ? { fromName: r.from_name } : {}),
    subject: r.subject,
    excerpt: excerptOf(r.start ?? ''),
    labelId: r.label_id,
    markedAt: r.marked_at,
  }));
}

export interface StoredExample {
  accountId: string;
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  /** The user's answer. */
  labelId: string | null;
  markedAt: number;
  status: 'pending' | 'captured' | 'gone';
}

/** What is held as examples, newest answers first, without the content. */
export async function listExamples(db: Sql, accountId?: string, limit = 500): Promise<StoredExample[]> {
  const rows = await db.all<{
    account_id: string;
    message_id: string;
    from_address: string;
    from_name: string | null;
    subject: string;
    label_id: string | null;
    marked_at: number;
    status: StoredExample['status'];
  }>(
    `SELECT e.account_id, e.message_id, m.from_address, m.from_name, m.subject, e.label_id, e.marked_at, e.status
       FROM examples e JOIN messages m ON m.account_id = e.account_id AND m.id = e.message_id
       WHERE (? IS NULL OR e.account_id = ?) ORDER BY e.marked_at DESC, e.message_id LIMIT ?`,
    accountId ?? null,
    accountId ?? null,
    limit,
  );
  return rows.map((r) => ({
    accountId: r.account_id,
    messageId: r.message_id,
    fromAddress: r.from_address,
    fromName: r.from_name,
    subject: r.subject,
    labelId: r.label_id,
    markedAt: r.marked_at,
    status: r.status,
  }));
}

/**
 * Delete stored examples: one message's, or all of an account's. The stored message goes; the user's
 * answer stays in `feedback`, and so does any rule it made. Returns how many were deleted.
 */
export async function deleteExamples(db: Sql, accountId: string, messageId?: string): Promise<number> {
  const result =
    messageId === undefined
      ? await db.run('DELETE FROM examples WHERE account_id = ?', accountId)
      : await db.run('DELETE FROM examples WHERE account_id = ? AND message_id = ?', accountId, messageId);
  return result.changes;
}

/** Delete examples the user answered for more than `keepDays` days ago. Returns how many were deleted. */
export async function pruneExamples(db: Sql, keepDays: number, now: number = Date.now()): Promise<number> {
  return (await db.run('DELETE FROM examples WHERE marked_at < ?', now - keepDays * 86_400_000)).changes;
}
