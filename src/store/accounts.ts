import type { Sql } from './sql.ts';
import type { Store } from './store.ts';
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
 * Returns the person it belongs to.
 */
export async function connectAccount(store: Store, email: string, historyId: string, now: number = Date.now(), userId?: number): Promise<number> {
  const user = await store.central.transaction(async (tx) => {
    const known = await tx.get<{ user_id: number }>('SELECT user_id FROM accounts WHERE id = ?', email);
    if (known) return known.user_id;
    let person = userId;
    if (person === undefined) {
      const first = (await tx.get('SELECT 1 FROM users LIMIT 1')) === undefined;
      person = (await tx.run('INSERT INTO users (owner, created_at) VALUES (?, ?)', first ? 1 : 0, now)).lastInsertRowid;
    }
    await tx.run('INSERT INTO accounts (id, email, user_id, created_at) VALUES (?, ?, ?, ?)', email, email, person, now);
    return person;
  });
  await addMailbox(await store.user(user), email, historyId, now);
  return user;
}

/** A mailbox in one person's own database, or its cursor reset if it is there already. */
export async function addMailbox(db: Sql, id: string, historyId: string, now: number = Date.now()): Promise<void> {
  await db.run(
    'INSERT INTO mailboxes (id, history_id, created_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET history_id = excluded.history_id',
    id,
    historyId,
    now,
  );
}

/** The person an account belongs to, or null if it is not connected. */
export async function userOf(central: Sql, email: string): Promise<User | null> {
  const row = await central.get<{ id: number; owner: number }>(
    'SELECT u.id, u.owner FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.email = ?',
    email,
  );
  return row ? { id: row.id, owner: row.owner === 1 } : null;
}

/** The person who owns the install, once someone has signed in. */
export async function owner(central: Sql): Promise<User | null> {
  const row = await central.get<{ id: number }>('SELECT id FROM users WHERE owner = 1 ORDER BY id LIMIT 1');
  return row ? { id: row.id, owner: true } : null;
}

export async function listUsers(central: Sql): Promise<User[]> {
  return (await central.all<{ id: number; owner: number }>('SELECT id, owner FROM users ORDER BY id')).map((r) => ({ id: r.id, owner: r.owner === 1 }));
}

/** Every connected address, everyone's; or one person's, given `userId`. */
export async function connectedAddresses(central: Sql, userId?: number): Promise<string[]> {
  const rows =
    userId === undefined
      ? await central.all<{ email: string }>('SELECT email FROM accounts ORDER BY email')
      : await central.all<{ email: string }>('SELECT email FROM accounts WHERE user_id = ? ORDER BY email', userId);
  return rows.map((r) => r.email);
}

/** When the account's last sync began, or null before its first. */
export async function lastSyncedAt(db: Sql, accountId: string): Promise<number | null> {
  return (await db.get<{ at: number | null }>('SELECT last_synced_at AS at FROM mailboxes WHERE id = ?', accountId))?.at ?? null;
}

/** The mailboxes in one person's database. */
export async function listAccounts(db: Sql): Promise<Account[]> {
  const rows = await db.all<{ id: string; history_id: string | null }>('SELECT id, history_id FROM mailboxes ORDER BY id');
  return rows.map((r) => ({ id: r.id, email: r.id, historyId: r.history_id }));
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
    await tx.run('UPDATE mailboxes SET history_id = ?, last_synced_at = ? WHERE id = ?', historyId, now, accountId);
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
