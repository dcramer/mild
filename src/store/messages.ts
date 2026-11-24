import { type SQL, and, asc, count, decisions, desc, eq, feedback, inArray, isNull, lte, mailboxes, max, messages, notExists, or, sql } from './query.ts';
import { mailboxAliases } from './accounts.ts';
import { rememberMail } from './addresses.ts';
import { outOfTries } from './runs.ts';
import type { Sql } from './sql.ts';
import { type ContentFacts, type Facts, type RuleFacts, deriveFacts } from '../triage/facts.ts';
import type { MessageFacts } from '../triage/types.ts';
import { openEnvelope, openFacts, sealFacts, sealMessage } from './content.ts';
import { plain } from '../plain.ts';
import { ofMessage } from './decisions.ts';

const COLUMNS = {
  id: messages.id,
  threadId: messages.threadId,
  receivedAt: messages.receivedAt,
  headers: messages.headers,
  labelIds: messages.labelIds,
  suggestOnly: messages.suggestOnly,
  applyRule: messages.applyRule,
  facts: messages.facts,
};

interface Row {
  id: string;
  threadId: string;
  receivedAt: number;
  headers: string;
  labelIds: string[];
  suggestOnly: boolean;
  applyRule: string | null;
  facts: Facts;
}

const toMessage = (db: Sql, accountId: string, stored: Row): MessageFacts => {
  const r = plain(openEnvelope(db, accountId, stored.id, stored));
  return {
    accountId,
    messageId: r.id,
    threadId: r.threadId,
    from: { address: r.fromAddress, domain: r.fromDomain, ...(r.fromName ? { name: r.fromName } : {}) },
    to: r.to,
    cc: r.cc,
    subject: r.subject,
    labelIds: r.labelIds,
    headers: r.headers,
    receivedAt: r.receivedAt,
    known: openFacts(r.facts, r.headers),
  };
};

export interface QueuedMessage {
  facts: MessageFacts;
  /** First recorded by an inbox run that only suggests: suggest, never act. */
  suggestOnly: boolean;
  /** The rule the user applied to their inbox when this was pulled in: what it decides here is carried out. */
  applyRule: string | null;
  /** The model has failed on it `MAX_ATTEMPTS` times: it is not asked again. */
  outOfTries: boolean;
}

/**
 * For a query over messages: no decision has been recorded for it. `decided` narrows it to the few that may not have
 * one (`messages_undecided`); the decisions themselves say, so mail decided by code that did not set it is still left out.
 */
export const noDecision = (db: Sql) => and(eq(messages.decided, false), notExists(db.select({ id: decisions.id }).from(decisions).where(ofMessage)));

/**
 * Recorded messages that have no decision yet, newest first, rebuilt as triage input. This is the triage queue.
 * Newest first because mail can wait in it (with no model, what no rule covers is left there), and what waits
 * must never keep new mail from being classified.
 */
export async function listUndecided(db: Sql, accountId: string, limit: number): Promise<QueuedMessage[]> {
  const rows = await db
    .select({ ...COLUMNS, outOfTries: outOfTries(db, messages.accountId, messages.id).mapWith(Boolean) })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), noDecision(db)))
    .orderBy(desc(messages.receivedAt), asc(messages.id))
    .limit(limit);
  return rows.map((r) => ({ suggestOnly: r.suggestOnly, applyRule: r.applyRule, outOfTries: r.outOfTries, facts: toMessage(db, accountId, r) }));
}

/** One recorded message as `listUndecided` gives it, decided or not; null if Mild never saw it. */
export async function queuedMessage(db: Sql, accountId: string, messageId: string): Promise<QueuedMessage | null> {
  const [r] = await db
    .select({ ...COLUMNS, outOfTries: outOfTries(db, messages.accountId, messages.id).mapWith(Boolean) })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  return r ? { suggestOnly: r.suggestOnly, applyRule: r.applyRule, outOfTries: r.outOfTries, facts: toMessage(db, accountId, r) } : null;
}

/** The facts recorded for a message, or null if Mild has not seen it. */
export async function storedFacts(db: Sql, accountId: string, messageId: string): Promise<Facts | null> {
  const [row] = await db
    .select({ facts: messages.facts, headers: messages.headers })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  return row ? openFacts(row.facts, plain(openEnvelope(db, accountId, messageId, { headers: row.headers }).headers)) : null;
}

/** Add to a message's recorded facts what reading the whole message or its thread showed. What an earlier read showed stays. */
export async function recordFacts(db: Sql, accountId: string, messageId: string, facts: Facts): Promise<void> {
  await db
    .update(messages)
    .set({ facts: sql`${messages.facts} || ${JSON.stringify(sealFacts(facts))}::jsonb` })
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
}

/** The recorded messages of a thread, oldest first, with their labels: what Gmail's `threads.get` would say of those Mild has. */
export async function recordedThread(db: Sql, accountId: string, threadId: string): Promise<{ id: string; labelIds: string[] }[]> {
  return await db
    .select({ id: messages.id, labelIds: messages.labelIds })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.threadId, threadId)))
    .orderBy(asc(messages.receivedAt), asc(messages.id));
}

/**
 * The earlier messages of `messageId`'s conversation that Mild has recorded in the inbox and that may leave it with it, each
 * with its sender: not one the person answered for, nor one Mild left for review. None when the owner wrote in the
 * conversation, as the record or the thread's facts show, since the model may not hide such a conversation either.
 */
export async function earlierInInbox(db: Sql, accountId: string, messageId: string): Promise<{ id: string; fromAddress: string }[]> {
  const [self] = await db
    .select({ threadId: messages.threadId, receivedAt: messages.receivedAt })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  if (!self) return [];
  const thread = await db
    .select({ id: messages.id, receivedAt: messages.receivedAt, labelIds: messages.labelIds, headers: messages.headers })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.threadId, self.threadId)));
  if (thread.some((m) => m.labelIds.includes('SENT')) || (await storedFacts(db, accountId, messageId))?.ownerInThread) return [];
  // Older as Inbox orders a conversation, whose newest it shows.
  const earlier = thread.filter(
    (m) => m.labelIds.includes('INBOX') && (m.receivedAt < self.receivedAt || (m.receivedAt === self.receivedAt && m.id < messageId)),
  );
  if (earlier.length === 0) return [];
  const ids = earlier.map((m) => m.id);
  const decided = await db
    .select({ id: decisions.id, messageId: decisions.messageId, disposition: decisions.disposition })
    .from(decisions)
    .where(and(eq(decisions.accountId, accountId), inArray(decisions.messageId, ids)))
    .orderBy(asc(decisions.id));
  const latest = new Map(decided.map((d) => [d.messageId, d.disposition] as const));
  const answered = new Set(
    (
      await db
        .select({ messageId: decisions.messageId })
        .from(feedback)
        .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
        .where(and(eq(decisions.accountId, accountId), inArray(decisions.messageId, ids)))
    ).map((r) => r.messageId),
  );
  return earlier
    .filter((m) => latest.get(m.id) !== 'review' && !answered.has(m.id))
    .map((m) => ({ id: m.id, fromAddress: plain(openEnvelope(db, accountId, m.id, { headers: m.headers }).fromAddress) }));
}

/**
 * The user applied `ruleId` to their inbox: once a model has said what this message is, what that rule decides is carried out.
 * In the triage queue, where the model is asked, even if it was recorded out of it.
 */
export async function markApplying(db: Sql, accountId: string, messageId: string, ruleId: string): Promise<void> {
  await db
    .update(messages)
    .set({ applyRule: ruleId, decided: false })
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
}

/** One recorded message as triage input, or null if Mild never saw it. */
export async function getFacts(db: Sql, accountId: string, messageId: string): Promise<MessageFacts | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  return row ? toMessage(db, accountId, row) : null;
}

/**
 * When the mailbox's latest recorded mail reached Gmail, up to `now`; null when none has. Imported or inserted mail
 * carries the date it was given, which can be later than now.
 */
export async function latestArrival(db: Sql, accountId: string, now: number): Promise<number | null> {
  const [row] = await db
    .select({ at: max(messages.receivedAt) })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), lte(messages.receivedAt, now)));
  return row!.at;
}

// As `messages_inbox` is written, so the index serves it.
const inInbox = sql`${messages.labelIds} @> '["INBOX"]'::jsonb`;

/** The newest `most` of what the record says is in the inbox, newest first: all of it once Inbox has copied the mailbox (`copied`). */
export async function recordedInbox(db: Sql, accountId: string, most: number): Promise<string[]> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), inInbox))
    .orderBy(desc(messages.receivedAt), asc(messages.id))
    .limit(most);
  return rows.map((r) => r.id);
}

export async function recordedInboxSize(db: Sql, accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), inInbox));
  return row!.n;
}

/** Message ids are asked for this many at a time: one history can name thousands, such as a whole inbox archived in Gmail. */
const IDS_AT_ONCE = 1000;

/**
 * Bring recorded messages' labels to what Gmail's history says, each change in history's order, so the last change to a
 * label stands. Reading the same history again leaves the same labels, so a sync that fails before its cursor moves can.
 */
export async function followLabels(db: Sql, accountId: string, history: readonly { messageId: string; added: string[]; removed: string[] }[]): Promise<void> {
  const byMessage = Map.groupBy(history, (change) => change.messageId);
  const ids = [...byMessage.keys()];
  for (let at = 0; at < ids.length; at += IDS_AT_ONCE) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: messages.id, labelIds: messages.labelIds })
        .from(messages)
        .where(and(eq(messages.accountId, accountId), inArray(messages.id, ids.slice(at, at + IDS_AT_ONCE))));
      for (const row of rows) {
        const labels = new Set(row.labelIds);
        for (const change of byMessage.get(row.id)!) {
          for (const label of change.added) labels.add(label);
          for (const label of change.removed) labels.delete(label);
        }
        if (labels.size === row.labelIds.length && row.labelIds.every((label) => labels.has(label))) continue;
        await tx
          .update(messages)
          .set({ labelIds: [...labels] })
          .where(and(eq(messages.accountId, accountId), eq(messages.id, row.id)));
      }
    });
  }
}

/** A recorded message's labels as Gmail just gave them, so what lists the inbox is right before the next sync reads the change back. */
export async function recordLabels(db: Sql, accountId: string, messageId: string, labelIds: readonly string[]): Promise<void> {
  await db
    .update(messages)
    .set({ labelIds: [...labelIds] })
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
}

/** Facts that hold a name or null: `true` or `false` against one asks whether there is a name. */
const NAMED = new Set(['listId', 'bulkService', 'category']);

/**
 * Conditions on a message's recorded facts, held as `matchesFacts` holds them, for a query on `messages`.
 * A fact not recorded for the message fails its condition. Equality is containment, which the facts' index serves.
 */
export function factsWhere(conditions: RuleFacts): SQL {
  const has = (key: string, value: unknown) => sql`${messages.facts} @> ${JSON.stringify({ [key]: value })}::jsonb`;
  return and(
    ...Object.entries(conditions).map(([key, want]) => {
      if (typeof want === 'boolean' && NAMED.has(key)) return sql`jsonb_typeof(${messages.facts} -> ${key}::text) ${want ? sql`= 'string'` : sql`= 'null'`}`;
      return Array.isArray(want) ? or(...want.map((value: unknown) => has(key, value))) : has(key, want);
    }),
  )!;
}

/**
 * Record messages Mild has read from Gmail, with their subject and triage headers and no body; one already recorded is
 * left as it is. `read` is what reading the message whole showed, for a message read so. Returns how many were new.
 */
export async function insertMessages(
  db: Sql,
  accountId: string,
  recorded: readonly MessageFacts[],
  now: number,
  record: { suggestOnly?: boolean; decided?: boolean; read?: ContentFacts } = {},
): Promise<number> {
  if (recorded.length === 0) return 0;
  const aliases = await mailboxAliases(db, accountId);
  const mail = recorded.map((message) => ({ message, facts: deriveFacts(message, record.read ?? {}, aliases) }));
  const added = await db
    .insert(messages)
    .values(
      mail.map(({ message: m, facts }) => ({
        accountId,
        id: m.messageId,
        threadId: m.threadId,
        receivedAt: m.receivedAt,
        ...sealMessage(db, accountId, m.messageId, m),
        labelIds: m.labelIds,
        syncedAt: now,
        suggestOnly: record.suggestOnly ?? false,
        decided: record.decided ?? false,
        facts: sealFacts(facts),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: messages.id });
  await rememberMail(db, accountId, mail, aliases);
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
  recorded: readonly MessageFacts[],
  historyId: string,
  now: number = Date.now(),
  read: readonly string[] = [],
): Promise<number> {
  return await db.transaction(async (tx) => {
    const added = await insertMessages(tx, accountId, recorded, now);
    for (const id of read)
      await tx
        .update(messages)
        .set({ readAt: now })
        .where(and(eq(messages.accountId, accountId), eq(messages.id, id), isNull(messages.readAt)));
    await tx.update(mailboxes).set({ historyId, lastSyncedAt: now }).where(eq(mailboxes.id, accountId));
    return added;
  });
}

/** Record synced messages before the cursor moves, for a sync too long to fetch in one go. Returns how many were not already known. */
export async function recordSynced(db: Sql, accountId: string, recorded: readonly MessageFacts[], now: number = Date.now()): Promise<number> {
  return await db.transaction(async (tx) => await insertMessages(tx, accountId, recorded, now));
}

/**
 * Record mail found in the inbox that Mild had not seen, read for a look that decides nothing (what a rule would do), so it
 * is not read again. Out of the triage queue, as the copy's mail is: going through the inbox or applying a rule decides it.
 */
export async function recordFound(db: Sql, accountId: string, recorded: readonly MessageFacts[], now: number): Promise<void> {
  await db.transaction(async (tx) => await insertMessages(tx, accountId, recorded, now, { decided: true }));
}

/**
 * Record mail an inbox run found that Mild had not seen. It does not move the sync cursor. `suggestOnly`
 * when the run only suggests, so a pass that decides it first never carries it out either. Returns how many were not already known.
 */
export async function recordFromInbox(
  db: Sql,
  accountId: string,
  recorded: readonly MessageFacts[],
  suggestOnly: boolean,
  now: number = Date.now(),
): Promise<number> {
  return await db.transaction(async (tx) => await insertMessages(tx, accountId, recorded, now, { suggestOnly }));
}
