import type { DatabaseSync } from 'node:sqlite';
import { parseListId } from '../triage/features.ts';
import type { MessageFacts } from '../triage/types.ts';

export interface Account {
  id: string;
  email: string;
  historyId: string | null;
}

/** Add an account, or reset its cursor if it is already connected. The account id is its email address. */
export function connectAccount(db: DatabaseSync, email: string, historyId: string, now: number = Date.now()): void {
  db.prepare(
    `INSERT INTO accounts (id, email, history_id, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET history_id = excluded.history_id`,
  ).run(email, email, historyId, now);
}

export function listAccounts(db: DatabaseSync): Account[] {
  const rows = db.prepare('SELECT id, email, history_id FROM accounts ORDER BY email').all() as { id: string; email: string; history_id: string | null }[];
  return rows.map((r) => ({ id: r.id, email: r.email, historyId: r.history_id }));
}

/**
 * Record newly synced messages and advance the cursor atomically, so a crash can neither lose a
 * message nor skip one. Stores the subject and triage headers, never the body.
 * Returns how many messages were not already known.
 */
export function recordSync(db: DatabaseSync, accountId: string, messages: readonly MessageFacts[], historyId: string, now: number = Date.now()): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO messages
       (account_id, id, thread_id, from_address, from_domain, from_name, list_id, received_at, subject, to_json, cc_json, headers_json, labels_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const m of messages) {
      const result = insert.run(
        accountId,
        m.messageId,
        m.threadId,
        m.from.address,
        m.from.domain,
        m.from.name ?? null,
        parseListId(m.headers['list-id']),
        m.receivedAt,
        m.subject,
        JSON.stringify(m.to),
        JSON.stringify(m.cc),
        JSON.stringify(m.headers),
        JSON.stringify(m.labelIds),
        now,
      );
      added += Number(result.changes);
    }
    db.prepare('UPDATE accounts SET history_id = ?, last_synced_at = ? WHERE id = ?').run(historyId, now, accountId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return added;
}
