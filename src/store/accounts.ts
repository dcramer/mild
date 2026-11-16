import { and, asc, eq, isNull, accounts, mailboxes, messages as messageRows, users } from './query.ts';
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
    const [known] = await tx.select({ userId: accounts.userId }).from(accounts).where(eq(accounts.id, email));
    if (known) return known.userId;
    let person = userId;
    if (person === undefined) {
      const first = (await tx.select({ id: users.id }).from(users).limit(1)).length === 0;
      [{ id: person }] = (await tx
        .insert(users)
        .values({ owner: first ? 1 : 0, createdAt: now })
        .returning({ id: users.id })) as [{ id: number }];
    }
    await tx.insert(accounts).values({ id: email, email, userId: person, createdAt: now });
    return person;
  });
  await addMailbox(await store.user(user), email, historyId, now);
  return user;
}

/** A mailbox in one person's own database, or its cursor reset if it is there already. */
export async function addMailbox(db: Sql, id: string, historyId: string, now: number = Date.now()): Promise<void> {
  await db
    .insert(mailboxes)
    .values({ id, historyId, createdAt: now })
    .onConflictDoUpdate({ target: [mailboxes.userId, mailboxes.id], set: { historyId } });
}

/** The person an account belongs to, or null if it is not connected. */
export async function userOf(central: Sql, email: string): Promise<User | null> {
  const [row] = await central
    .select({ id: users.id, owner: users.owner })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(eq(accounts.email, email));
  return row ? { id: row.id, owner: row.owner === 1 } : null;
}

/** The person who owns the install, once someone has signed in. */
export async function owner(central: Sql): Promise<User | null> {
  const [row] = await central.select({ id: users.id }).from(users).where(eq(users.owner, 1)).orderBy(asc(users.id)).limit(1);
  return row ? { id: row.id, owner: true } : null;
}

export async function listUsers(central: Sql): Promise<User[]> {
  return (await central.select({ id: users.id, owner: users.owner }).from(users).orderBy(asc(users.id))).map((r) => ({ id: r.id, owner: r.owner === 1 }));
}

/** Every connected address, everyone's; or one person's, given `userId`. */
export async function connectedAddresses(central: Sql, userId?: number): Promise<string[]> {
  const rows = await central
    .select({ email: accounts.email })
    .from(accounts)
    .where(userId === undefined ? undefined : eq(accounts.userId, userId))
    .orderBy(asc(accounts.email));
  return rows.map((r) => r.email);
}

/** Whose rows `db` reads and writes. */
export async function personOf(db: Sql): Promise<number> {
  if (db.person === null) throw new Error('The central handle is no one’s.');
  return db.person;
}

/** When the account's last sync began, or null before its first. */
export async function lastSyncedAt(db: Sql, accountId: string): Promise<number | null> {
  const [row] = await db.select({ at: mailboxes.lastSyncedAt }).from(mailboxes).where(eq(mailboxes.id, accountId));
  return row?.at ?? null;
}

/** The mailboxes in one person's database. */
export async function listAccounts(db: Sql): Promise<Account[]> {
  const rows = await db.select({ id: mailboxes.id, historyId: mailboxes.historyId }).from(mailboxes).orderBy(asc(mailboxes.id));
  return rows.map((r) => ({ id: r.id, email: r.id, historyId: r.historyId }));
}

async function insertMessages(db: Sql, accountId: string, messages: readonly MessageFacts[], now: number, observeOnly: boolean): Promise<number> {
  if (messages.length === 0) return 0;
  const added = await db
    .insert(messageRows)
    .values(
      messages.map((m) => ({
        accountId,
        id: m.messageId,
        threadId: m.threadId,
        fromAddress: m.from.address,
        fromDomain: m.from.domain,
        fromName: m.from.name ?? null,
        listId: parseListId(m.headers['list-id']),
        receivedAt: m.receivedAt,
        subject: m.subject,
        toJson: JSON.stringify(m.to),
        ccJson: JSON.stringify(m.cc),
        headersJson: JSON.stringify(m.headers),
        labelsJson: JSON.stringify(m.labelIds),
        syncedAt: now,
        observeOnly: observeOnly ? 1 : 0,
        factsJson: JSON.stringify(deriveFacts(m)),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: messageRows.id });
  return added.length;
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
    for (const id of read)
      await tx
        .update(messageRows)
        .set({ readAt: now })
        .where(and(eq(messageRows.accountId, accountId), eq(messageRows.id, id), isNull(messageRows.readAt)));
    await tx.update(mailboxes).set({ historyId, lastSyncedAt: now }).where(eq(mailboxes.id, accountId));
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
