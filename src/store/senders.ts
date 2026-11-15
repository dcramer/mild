import type { DatabaseSync } from 'node:sqlite';
import type { SenderRecord } from '../triage/stages/sender.ts';
import type { DecidedDisposition, Disposition } from '../triage/types.ts';

/** What sift has learned about a sender, or null if nothing. */
export function lookupSender(db: DatabaseSync, accountId: string, address: string): SenderRecord | null {
  const row = db
    .prepare(
      `SELECT s.disposition, s.label, s.category, coalesce(c.user_has_written, s.user_has_replied) AS written
       FROM senders s LEFT JOIN correspondents c ON c.account_id = s.account_id AND c.address = s.address
       WHERE s.account_id = ? AND s.address = ?`,
    )
    .get(accountId, address) as { disposition: DecidedDisposition; label: string | null; category: string | null; written: number } | undefined;
  if (!row) return null;
  return {
    disposition: row.disposition,
    ...(row.label ? { label: row.label } : {}),
    ...(row.category ? { category: row.category } : {}),
    userHasReplied: row.written === 1,
  };
}

/** How many consecutive model decisions must agree before a sender is remembered. */
export const LEARN_AFTER = 3;

/**
 * Remember a sender once the model has put their last few messages in the same category with the same
 * outcome, so later mail from them needs no inference. Senders who send mixed mail never settle and are
 * never learned. A record the user or a correction created is left alone. Returns true if one was written.
 */
export function learnSender(db: DatabaseSync, accountId: string, address: string, now: number = Date.now()): boolean {
  const recent = db
    .prepare(
      `SELECT d.category, d.disposition, d.label FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.from_address = ? AND d.stage = 'agent'
       ORDER BY d.id DESC LIMIT ?`,
    )
    .all(accountId, address, LEARN_AFTER) as unknown as { category: string | null; disposition: Disposition; label: string | null }[];
  const [first] = recent;
  if (!first || recent.length < LEARN_AFTER || first.category === null || first.disposition === 'review') return false;
  if (!recent.every((r) => r.category === first.category && r.disposition === first.disposition && r.label === first.label)) return false;

  const result = db
    .prepare(
      `INSERT INTO senders (account_id, address, disposition, label, category, source, updated_at) VALUES (?, ?, ?, ?, ?, 'agent', ?)
       ON CONFLICT (account_id, address) DO UPDATE
         SET disposition = excluded.disposition, label = excluded.label, category = excluded.category, updated_at = excluded.updated_at
         WHERE senders.source = 'agent'`,
    )
    .run(accountId, address, first.disposition, first.label, first.category, now);
  return Number(result.changes) > 0;
}

/** What sift has recorded about mail from an address: how much, and what was done with it. */
export function senderHistory(
  db: DatabaseSync,
  accountId: string,
  address: string,
): { messagesSeen: number; pastDispositions: Partial<Record<Disposition, number>> } {
  const { n } = db.prepare('SELECT count(*) AS n FROM messages WHERE account_id = ? AND from_address = ?').get(accountId, address) as { n: number };
  // The current decision for each earlier message from this sender.
  const rows = db
    .prepare(
      `SELECT d.disposition, count(*) AS n FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.from_address = ?
         AND d.id = (SELECT max(id) FROM decisions WHERE account_id = d.account_id AND message_id = d.message_id)
       GROUP BY d.disposition`,
    )
    .all(accountId, address) as unknown as { disposition: Disposition; n: number }[];
  return { messagesSeen: n, pastDispositions: Object.fromEntries(rows.map((r) => [r.disposition, r.n])) };
}

const CORRESPONDENT_TTL_MS = 7 * 86_400_000;

/** The cached answer to "has the owner written to this address", or undefined if unknown or stale. A yes never goes stale. */
export function cachedCorrespondent(db: DatabaseSync, accountId: string, address: string, now: number = Date.now()): boolean | undefined {
  const row = db.prepare('SELECT user_has_written, checked_at FROM correspondents WHERE account_id = ? AND address = ?').get(accountId, address) as
    | { user_has_written: number; checked_at: number }
    | undefined;
  if (!row) return undefined;
  if (row.user_has_written === 1) return true;
  return now - row.checked_at < CORRESPONDENT_TTL_MS ? false : undefined;
}

export function rememberCorrespondent(db: DatabaseSync, accountId: string, address: string, userHasWritten: boolean, now: number = Date.now()): void {
  db.prepare(
    `INSERT INTO correspondents (account_id, address, user_has_written, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (account_id, address) DO UPDATE SET user_has_written = excluded.user_has_written, checked_at = excluded.checked_at`,
  ).run(accountId, address, userHasWritten ? 1 : 0, now);
}
