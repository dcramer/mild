import { and, count, eq, isNull, mailBodies, messages, preferences, sql, suggestionBodies } from './query.ts';
import type { Sql } from './sql.ts';
import { openEnvelope, openPart, sealFacts, sealMessage, sealPart } from './content.ts';
import { type Searched, searchIndex } from './search.ts';
import { plain } from '../plain.ts';
import { mailboxAliases } from './accounts.ts';
import { type ContentFacts, deriveFacts } from '../triage/facts.ts';
import type { MessageFacts } from '../triage/types.ts';

/**
 * Runs `write` only while Inbox is on, holding a share lock on the person's preferences: turning Inbox off waits for a write
 * under way, and its delete finds it; once it is off, nothing is written. Null when it was off.
 */
async function whileInboxOn<T>(db: Sql, write: (tx: Sql) => Promise<T>): Promise<T | null> {
  return await db.transaction(async (tx) => {
    const [on] = await tx.select({ mail: preferences.mail }).from(preferences).for('share');
    return on?.mail ? await write(tx) : null;
  });
}

/** A message's text as Inbox keeps it: all of its readable text, its HTML part, and what reading it whole showed. */
export interface Text {
  text: string;
  html: string | null;
  read: ContentFacts;
}

/** `from` and `subject` are the message's, for its search index with the text. */
const bodyOf = (db: Sql, accountId: string, messageId: string, text: Text, envelope: Omit<Searched, 'text'>, now: number) => ({
  accountId,
  messageId,
  bodyText: sealPart(db, accountId, messageId, 'text', text.text)!,
  bodyHtml: sealPart(db, accountId, messageId, 'html', text.html),
  search: searchIndex(db, { ...envelope, text: text.text }),
  fetchedAt: now,
});

/** What a recorded message's index is made from besides its text: its sender and subject, from its encrypted headers. */
async function envelopeOf(db: Sql, accountId: string, messageId: string): Promise<Omit<Searched, 'text'>> {
  const [row] = await db
    .select({ headers: messages.headers })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  // Text is kept only of a recorded message (`mail_bodies` references it).
  const opened = openEnvelope(db, accountId, messageId, row!);
  return { fromName: plain(opened.fromName), fromAddress: plain(opened.fromAddress), subject: plain(opened.subject) };
}

/**
 * Record mail Inbox copies and Sift does not triage, with its text: mail from before Sift was connected, mail that never
 * reached the inbox, the person's own. Decided already, so it is never in the triage queue; going through the inbox still
 * decides what of it is in the inbox. Only while Inbox is on. Safe to repeat. Returns false when Inbox was off.
 */
export async function recordKept(db: Sql, accountId: string, mail: { facts: MessageFacts; text: Text }, now: number): Promise<boolean> {
  const aliases = await mailboxAliases(db, accountId);
  const { facts: m } = mail;
  const kept = await whileInboxOn(db, async (tx) => {
    await tx
      .insert(messages)
      .values({
        accountId,
        id: m.messageId,
        threadId: m.threadId,
        receivedAt: m.receivedAt,
        ...sealMessage(tx, accountId, m.messageId, m),
        labelIds: [...m.labelIds],
        syncedAt: now,
        facts: sealFacts(deriveFacts(m, mail.text.read, aliases)),
        decided: true,
      })
      .onConflictDoNothing();
    await tx
      .insert(mailBodies)
      .values(bodyOf(tx, accountId, m.messageId, mail.text, { fromName: m.from.name ?? null, fromAddress: m.from.address, subject: m.subject }, now))
      .onConflictDoNothing();
    return true;
  });
  return kept === true;
}

/** Keep the text of a message Sift has recorded, and add what reading it whole showed to its facts. Only while Inbox is on. Returns false when Inbox was off. */
export async function keepText(db: Sql, accountId: string, messageId: string, text: Text, now: number): Promise<boolean> {
  const kept = await whileInboxOn(db, async (tx) => {
    const envelope = await envelopeOf(tx, accountId, messageId);
    await tx
      .insert(mailBodies)
      .values(bodyOf(tx, accountId, messageId, text, envelope, now))
      .onConflictDoNothing();
    await tx
      .update(messages)
      .set({ facts: sql`${messages.facts} || ${JSON.stringify(text.read)}::jsonb` })
      .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
    return true;
  });
  return kept === true;
}

/** Fewer than this and an average says more about those messages than about the person's mail. */
const ENOUGH = 20;

/** What the text and HTML of one of the person's messages take to keep, in bytes, on average; null with too few to say. */
export async function keptSize(db: Sql): Promise<number | null> {
  let bytes = 0;
  let n = 0;
  for (const table of [mailBodies, suggestionBodies]) {
    const [row] = await db
      .select({
        bytes: sql<number>`coalesce(sum(octet_length(${table.bodyText}) + coalesce(octet_length(${table.bodyHtml}), 0)), 0)`.mapWith(Number),
        n: count(),
      })
      .from(table);
    bytes += row?.bytes ?? 0;
    n += row?.n ?? 0;
  }
  return n >= ENOUGH ? bytes / n : null;
}

const READ = ['hasAttachments', 'words', 'trackingPixel', 'linkHosts', 'trackedLinks', 'linksOffDomain'] as const;

/**
 * Inbox's copy of a recorded message's text, so reading it costs Gmail nothing, with what reading it whole showed. Null when
 * there is none. Not the text kept of mail waiting on the person, which is only the model's share of it.
 */
export async function heldText(db: Sql, accountId: string, messageId: string): Promise<Text | null> {
  const [row] = await db
    .select({ text: mailBodies.bodyText, html: mailBodies.bodyHtml, facts: messages.facts })
    .from(mailBodies)
    .innerJoin(messages, and(eq(messages.accountId, mailBodies.accountId), eq(messages.id, mailBodies.messageId)))
    .where(and(eq(mailBodies.accountId, accountId), eq(mailBodies.messageId, messageId)));
  if (!row) return null;
  const read: Record<string, unknown> = { hasAttachments: false };
  for (const key of READ) if (row.facts[key] !== undefined) read[key] = row.facts[key];
  return {
    text: plain(openPart(db, accountId, messageId, 'text', row.text)) ?? '',
    html: plain(openPart(db, accountId, messageId, 'html', row.html)),
    read: read as unknown as ContentFacts,
  };
}

/** Read at once, a pass at a time: each is its text decrypted and a few thousand keyed hashes, about 3 ms. */
const INDEX_BATCH = 100;

/** Whether text kept before there was a search index waits for one. */
export async function searchDue(db: Sql, accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(mailBodies)
    .where(and(eq(mailBodies.accountId, accountId), isNull(mailBodies.search)))
    .limit(1);
  return row !== undefined;
}

/**
 * Index up to `most` messages whose text was kept before there was a search index, stopping once `over`. Safe to repeat:
 * a row is written only while it has none. Returns how many it indexed.
 */
export async function indexKept(db: Sql, accountId: string, most: number, over: () => boolean): Promise<number> {
  let done = 0;
  while (done < most && !over()) {
    const rows = await db
      .select({ messageId: mailBodies.messageId, text: mailBodies.bodyText, headers: messages.headers })
      .from(mailBodies)
      .innerJoin(messages, and(eq(messages.accountId, mailBodies.accountId), eq(messages.id, mailBodies.messageId)))
      .where(and(eq(mailBodies.accountId, accountId), isNull(mailBodies.search)))
      .limit(Math.min(INDEX_BATCH, most - done));
    if (rows.length === 0) break;
    await db.transaction(async (tx) => {
      for (const r of rows) {
        const opened = openEnvelope(tx, accountId, r.messageId, { headers: r.headers });
        const search = searchIndex(tx, {
          text: plain(openPart(tx, accountId, r.messageId, 'text', r.text)) ?? '',
          fromName: plain(opened.fromName),
          fromAddress: plain(opened.fromAddress),
          subject: plain(opened.subject),
        });
        await tx
          .update(mailBodies)
          .set({ search })
          .where(and(eq(mailBodies.accountId, accountId), eq(mailBodies.messageId, r.messageId), isNull(mailBodies.search)));
      }
    });
    done += rows.length;
  }
  return done;
}
