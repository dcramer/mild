import type { DatabaseSync } from 'node:sqlite';
import { deriveFacts } from '../triage/facts.ts';
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

/** When the account's last sync began, or null before its first. */
export function lastSyncedAt(db: DatabaseSync, accountId: string): number | null {
  return (db.prepare('SELECT last_synced_at AS at FROM accounts WHERE id = ?').get(accountId) as { at: number | null } | undefined)?.at ?? null;
}

export function listAccounts(db: DatabaseSync): Account[] {
  const rows = db.prepare('SELECT id, email, history_id FROM accounts ORDER BY email').all() as { id: string; email: string; history_id: string | null }[];
  return rows.map((r) => ({ id: r.id, email: r.email, historyId: r.history_id }));
}

const INSERT_MESSAGE = `INSERT OR IGNORE INTO messages
       (account_id, id, thread_id, from_address, from_domain, from_name, list_id, received_at, subject, to_json, cc_json, headers_json, labels_json, synced_at, observe_only, facts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertMessages(db: DatabaseSync, accountId: string, messages: readonly MessageFacts[], now: number, observeOnly: boolean): number {
  const insert = db.prepare(INSERT_MESSAGE);
  let added = 0;
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
      observeOnly ? 1 : 0,
      JSON.stringify(deriveFacts(m)),
    );
    added += Number(result.changes);
  }
  return added;
}

/**
 * Record newly synced messages and advance the cursor atomically, so a crash can neither lose a
 * message nor skip one. Stores the subject and triage headers, no body.
 * `read` are messages the user was seen to have opened, these or earlier ones; the first sighting stands.
 * Returns how many messages were not already known.
 */
export function recordSync(
  db: DatabaseSync,
  accountId: string,
  messages: readonly MessageFacts[],
  historyId: string,
  now: number = Date.now(),
  read: readonly string[] = [],
): number {
  db.exec('BEGIN');
  try {
    const added = insertMessages(db, accountId, messages, now, false);
    const opened = db.prepare('UPDATE messages SET read_at = ? WHERE account_id = ? AND id = ? AND read_at IS NULL');
    for (const id of read) opened.run(now, accountId, id);
    db.prepare('UPDATE accounts SET history_id = ?, last_synced_at = ? WHERE id = ?').run(historyId, now, accountId);
    db.exec('COMMIT');
    return added;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Record older mail the user asked to pull in. It does not move the sync cursor, and these messages are
 * only ever suggested about. Returns how many were not already known.
 */
export function recordBackfill(db: DatabaseSync, accountId: string, messages: readonly MessageFacts[], now: number = Date.now()): number {
  db.exec('BEGIN');
  try {
    const added = insertMessages(db, accountId, messages, now, true);
    db.exec('COMMIT');
    return added;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
