import type { Sql } from './sql.ts';
import { deriveFacts } from '../triage/facts.ts';
import { parseListId } from '../triage/features.ts';
import type { MessageFacts } from '../triage/types.ts';

export interface Account {
  id: string;
  email: string;
  historyId: string | null;
}

/** A person. Their accounts are the mailboxes they have signed in with. */
export interface User {
  id: number;
  /** The first user: the one who may change what applies to the whole install. */
  owner: boolean;
}

/**
 * Add an account, or reset its cursor if it is already connected. The account id is its email address.
 * A new account joins `userId`'s mailboxes when given (someone signed in connected it); otherwise it is
 * a new person's first, and the first person ever owns the install. An account never changes hands.
 */
export async function connectAccount(db: Sql, email: string, historyId: string, now: number = Date.now(), userId?: number): Promise<void> {
  if (await db.get('SELECT 1 FROM accounts WHERE id = ?', email)) {
    await db.run('UPDATE accounts SET history_id = ? WHERE id = ?', historyId, email);
    return;
  }
  await db.transaction(async (tx) => {
    let user = userId;
    if (user === undefined) {
      const first = (await tx.get('SELECT 1 FROM users LIMIT 1')) === undefined;
      user = (await tx.run('INSERT INTO users (owner, created_at) VALUES (?, ?)', first ? 1 : 0, now)).lastInsertRowid;
    }
    await tx.run('INSERT INTO accounts (id, email, history_id, created_at, user_id) VALUES (?, ?, ?, ?, ?)', email, email, historyId, now, user);
  });
}

/** The person an account belongs to, or null if it is not connected. */
export async function userOf(db: Sql, email: string): Promise<User | null> {
  const row = await db.get<{ id: number; owner: number }>('SELECT u.id, u.owner FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.email = ?', email);
  return row ? { id: row.id, owner: row.owner === 1 } : null;
}

/** A person's mailboxes, by address. */
export async function accountsOf(db: Sql, userId: number): Promise<Account[]> {
  const rows = await db.all<{
    id: string;
    email: string;
    history_id: string | null;
  }>('SELECT id, email, history_id FROM accounts WHERE user_id = ? ORDER BY email', userId);
  return rows.map((r) => ({ id: r.id, email: r.email, historyId: r.history_id }));
}

/** When the account's last sync began, or null before its first. */
export async function lastSyncedAt(db: Sql, accountId: string): Promise<number | null> {
  return (await db.get<{ at: number | null }>('SELECT last_synced_at AS at FROM accounts WHERE id = ?', accountId))?.at ?? null;
}

export async function listAccounts(db: Sql): Promise<Account[]> {
  const rows = await db.all<{ id: string; email: string; history_id: string | null }>('SELECT id, email, history_id FROM accounts ORDER BY email');
  return rows.map((r) => ({ id: r.id, email: r.email, historyId: r.history_id }));
}

const INSERT_MESSAGE = `INSERT OR IGNORE INTO messages
       (account_id, id, thread_id, from_address, from_domain, from_name, list_id, received_at, subject, to_json, cc_json, headers_json, labels_json, synced_at, observe_only, facts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function insertMessages(db: Sql, accountId: string, messages: readonly MessageFacts[], now: number, observeOnly: boolean): Promise<number> {
  let added = 0;
  for (const m of messages) {
    const result = await db.run(
      INSERT_MESSAGE,
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
    added += result.changes;
  }
  return added;
}

/**
 * Record newly synced messages and advance the cursor atomically, so a crash can neither lose a
 * message nor skip one. Stores the subject and triage headers, no body.
 * `read` are messages the user was seen to have opened, these or earlier ones; the first sighting stands.
 * Returns how many messages were not already known.
 */
export async function recordSync(
  db: Sql,
  accountId: string,
  messages: readonly MessageFacts[],
  historyId: string,
  now: number = Date.now(),
  read: readonly string[] = [],
): Promise<number> {
  return await db.transaction(async (tx) => {
    const added = await insertMessages(tx, accountId, messages, now, false);
    for (const id of read) await tx.run('UPDATE messages SET read_at = ? WHERE account_id = ? AND id = ? AND read_at IS NULL', now, accountId, id);
    await tx.run('UPDATE accounts SET history_id = ?, last_synced_at = ? WHERE id = ?', historyId, now, accountId);
    return added;
  });
}

/**
 * Record older mail the user asked to pull in. It does not move the sync cursor, and these messages are
 * only ever suggested about. Returns how many were not already known.
 */
export async function recordBackfill(db: Sql, accountId: string, messages: readonly MessageFacts[], now: number = Date.now()): Promise<number> {
  return await db.transaction(async (tx) => await insertMessages(tx, accountId, messages, now, true));
}
