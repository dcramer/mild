import type { DatabaseSync } from 'node:sqlite';
import type { Disposition } from '../triage/types.ts';

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
