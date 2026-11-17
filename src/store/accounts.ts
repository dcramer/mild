import { and, asc, eq, isNull, accounts, credentials, labels, mailboxes, messages as messageRows, users } from './query.ts';
import { everythingElseRow } from './labels.ts';
import type { Sql } from './sql.ts';
import { sealFacts, sealMessage } from './content.ts';
import type { Store } from './store.ts';
import { deriveFacts } from '../triage/facts.ts';
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
      [{ id: person }] = (await tx.insert(users).values({ owner: first, createdAt: now }).returning({ id: users.id })) as [{ id: number }];
    }
    await tx.insert(accounts).values({ id: email, userId: person, createdAt: now });
    return person;
  });
  await addMailbox(await store.user(user), email, historyId);
  return user;
}

/**
 * A mailbox in one person's own database, with its one starting label, unless it is there already. Its
 * `accounts` row must exist. Returns whether it was new.
 */
export async function ensureMailbox(db: Sql, mailbox: { id: string; historyId?: string | null }): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const added = await tx.insert(mailboxes).values(mailbox).onConflictDoNothing().returning({ id: mailboxes.id });
    if (added.length > 0) await tx.insert(labels).values(everythingElseRow(mailbox.id));
    return added.length > 0;
  });
}

/** A mailbox in one person's own database, or its cursor reset if it is there already. */
export async function addMailbox(db: Sql, id: string, historyId: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await ensureMailbox(tx, { id, historyId }))) await tx.update(mailboxes).set({ historyId }).where(eq(mailboxes.id, id));
  });
}

/**
 * Remove one of a person's mailboxes: its Gmail sign-in, then its account, which takes its mailbox and every
 * row of it along. Revoking the sign-in at Google is the caller's, before this. Returns false if the mailbox
 * is not theirs.
 */
export async function removeMailbox(store: Store, userId: number, email: string): Promise<boolean> {
  const [theirs] = await store.central
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, email), eq(accounts.userId, userId)));
  if (!theirs) return false;
  // The token first: a crash in between leaves a mailbox sift cannot read, not a token for one it no longer has.
  await (await store.user(userId)).delete(credentials).where(and(eq(credentials.kind, 'gmail'), eq(credentials.key, email)));
  await store.central.delete(accounts).where(and(eq(accounts.id, email), eq(accounts.userId, userId)));
  return true;
}

/**
 * Delete a person and everything of theirs, their sign-ins included. Revoking their Gmail sign-ins is the
 * caller's, before this. When they owned the install, the earliest person left owns it; with nobody left,
 * whoever signs in next does.
 */
export async function deleteUser(store: Store, userId: number): Promise<void> {
  await store.central.transaction(async (tx) => {
    const [gone] = await tx.delete(users).where(eq(users.id, userId)).returning({ owner: users.owner });
    if (!gone?.owner) return;
    const [next] = await tx.select({ id: users.id }).from(users).orderBy(asc(users.createdAt), asc(users.id)).limit(1);
    if (next) await tx.update(users).set({ owner: true }).where(eq(users.id, next.id));
  });
  store.forget(userId);
}

/** The person an account belongs to, or null if it is not connected. */
export async function userOf(central: Sql, email: string): Promise<User | null> {
  const [row] = await central
    .select({ id: users.id, owner: users.owner })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(eq(accounts.id, email));
  return row ?? null;
}

/** The person who owns the install, once someone has signed in. */
export async function owner(central: Sql): Promise<User | null> {
  const [row] = await central.select({ id: users.id }).from(users).where(eq(users.owner, true)).orderBy(asc(users.id)).limit(1);
  return row ? { id: row.id, owner: true } : null;
}

export async function listUsers(central: Sql): Promise<User[]> {
  return await central.select({ id: users.id, owner: users.owner }).from(users).orderBy(asc(users.id));
}

/** Every connected address, everyone's; or one person's, given `userId`. */
export async function connectedAddresses(central: Sql, userId?: number): Promise<string[]> {
  const rows = await central
    .select({ id: accounts.id })
    .from(accounts)
    .where(userId === undefined ? undefined : eq(accounts.userId, userId))
    .orderBy(asc(accounts.id));
  return rows.map((r) => r.id);
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

/** The mailbox's other addresses in Gmail, as its last sync found them. */
export async function mailboxAliases(db: Sql, accountId: string): Promise<string[]> {
  const [row] = await db.select({ aliases: mailboxes.aliases }).from(mailboxes).where(eq(mailboxes.id, accountId));
  return row?.aliases ?? [];
}

export async function setMailboxAliases(db: Sql, accountId: string, aliases: readonly string[]): Promise<void> {
  await db
    .update(mailboxes)
    .set({ aliases: aliases.filter((a) => a !== accountId) })
    .where(eq(mailboxes.id, accountId));
}

async function insertMessages(db: Sql, accountId: string, messages: readonly MessageFacts[], now: number, suggestOnly: boolean): Promise<number> {
  if (messages.length === 0) return 0;
  const aliases = await mailboxAliases(db, accountId);
  const added = await db
    .insert(messageRows)
    .values(
      messages.map((m) => ({
        accountId,
        id: m.messageId,
        threadId: m.threadId,
        receivedAt: m.receivedAt,
        ...sealMessage(db, accountId, m.messageId, m),
        labelIds: m.labelIds,
        syncedAt: now,
        suggestOnly,
        facts: sealFacts(deriveFacts(m, {}, aliases)),
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

/** Record synced messages before the cursor moves, for a sync too long to fetch in one go. Returns how many were not already known. */
export async function recordSynced(db: Sql, accountId: string, messages: readonly MessageFacts[], now: number = Date.now()): Promise<number> {
  return await db.transaction(async (tx) => await insertMessages(tx, accountId, messages, now, false));
}

/**
 * Record older mail the user asked to pull in. It does not move the sync cursor, and these messages are
 * only ever suggested about. Returns how many were not already known.
 */
export async function recordBackfill(db: Sql, accountId: string, messages: readonly MessageFacts[], now: number = Date.now()): Promise<number> {
  return await db.transaction(async (tx) => await insertMessages(tx, accountId, messages, now, true));
}
