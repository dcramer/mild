import { actions, alias, and, asc, decisions, desc, digests, eq, gt, inArray, isNull, labels, lte, max, messages } from './query.ts';
import type { Sql } from './sql.ts';
import { digestName, openEnvelope, openJson, sealJson } from './content.ts';
import type { Usage } from '../triage/stages/model.ts';
import { plain } from '../plain.ts';

/** The Message-ID a digest is given: `.invalid` is no one's domain, so no mail from anyone else carries one. */
const DIGEST_ID = /^<digest\.[\w-]+@sift\.invalid>$/;
const newDigestId = () => `<digest.${crypto.randomUUID()}@sift.invalid>`;

/** A message the model thought worth a look, by its Gmail id, and why in a line. */
export interface Highlight {
  id: string;
  why: string;
}

/** A label as its digest names it. */
interface DigestLabel {
  id: string;
  name: string;
  description: string;
  gmailLabel: string;
}

/** The ids of the labels whose mail goes in a digest, in order. */
export async function digestLabels(db: Sql): Promise<string[]> {
  const rows = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.digest, true), isNull(labels.removedAt)))
    .orderBy(asc(labels.position));
  return rows.map((r) => r.id);
}

/** Where the label's last digest ended, or null before its first. */
export async function lastDigestEnd(db: Sql, labelId: string): Promise<number | null> {
  const [row] = await db
    .select({ until: max(digests.until) })
    .from(digests)
    .where(eq(digests.labelId, labelId));
  return row?.until ?? null;
}

/** One message of a digest, from its record: who sent it, its subject, and when it arrived and was archived. */
export interface DigestItem {
  accountId: string;
  messageId: string;
  from: { name?: string; address: string };
  subject: string;
  receivedAt: number;
  archivedAt: number;
}

const latest = alias(decisions, 'latest');

/**
 * What a label's digest for `(since, until]` lists: mail whose decision still standing put it in the digest, was
 * Sift's own and not the person's answer, and was archived in Gmail in that window. An archive undone since is
 * not, nor mail the person has answered for since.
 */
const inWindow = (db: Sql, labelId: string, since: number, until: number) =>
  db
    .select({
      accountId: decisions.accountId,
      messageId: decisions.messageId,
      headers: messages.headers,
      receivedAt: messages.receivedAt,
      archivedAt: actions.completedAt,
    })
    .from(decisions)
    .innerJoin(
      actions,
      and(
        eq(actions.decisionId, decisions.id),
        eq(actions.type, 'archive'),
        eq(actions.status, 'done'),
        gt(actions.completedAt, since),
        lte(actions.completedAt, until),
      ),
    )
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .where(
      and(
        eq(decisions.labelId, labelId),
        eq(decisions.digest, true),
        eq(decisions.carryOut, true),
        eq(decisions.outcome, 'done'),
        eq(decisions.byUser, false),
        eq(
          decisions.id,
          db
            .select({ id: max(latest.id) })
            .from(latest)
            .where(and(eq(latest.accountId, decisions.accountId), eq(latest.messageId, decisions.messageId))),
        ),
      ),
    );

/** Whether the label's digest for the window would list anything. Nothing is decrypted. */
export async function hasDigestItems(db: Sql, labelId: string, since: number, until: number): Promise<boolean> {
  return (await inWindow(db, labelId, since, until).limit(1)).length > 0;
}

/** What the label's digest for the window lists, newest first. */
export async function digestItems(db: Sql, labelId: string, since: number, until: number): Promise<DigestItem[]> {
  const rows = await inWindow(db, labelId, since, until).orderBy(desc(messages.receivedAt));
  return rows.map((r) => {
    const { fromAddress, fromName, subject } = plain(openEnvelope(db, r.accountId, r.messageId, r));
    return {
      accountId: r.accountId,
      messageId: r.messageId,
      from: { address: fromAddress, ...(fromName ? { name: fromName } : {}) },
      subject,
      receivedAt: r.receivedAt,
      archivedAt: r.archivedAt!,
    };
  });
}

/** A digest written down, and how far it got. */
export interface DigestRecord {
  id: number;
  labelId: string;
  accountId: string;
  since: number;
  until: number;
  messageId: string;
  /** Null until the model's picks are recorded, and when it was not asked or failed. */
  highlights: Highlight[] | null;
}

const RECORD = {
  id: digests.id,
  labelId: digests.labelId,
  accountId: digests.accountId,
  since: digests.since,
  until: digests.until,
  messageId: digests.messageId,
  highlights: digests.highlights,
};

const fromRow = (db: Sql, { highlights, ...r }: Omit<DigestRecord, 'highlights'> & { highlights: string | null }): DigestRecord => ({
  ...r,
  highlights: highlights === null ? null : plain(openJson<Highlight[]>(db, digestName(db, r.id), highlights)),
});

/** Close a label's window by writing its digest down, before anything is asked or put in Gmail. */
export async function startDigest(
  db: Sql,
  digest: { labelId: string; accountId: string; since: number; until: number; count: number; model: string | null; now: number },
): Promise<DigestRecord> {
  const [row] = await db
    .insert(digests)
    .values({ ...digest, messageId: newDigestId(), createdAt: digest.now })
    .returning(RECORD);
  return fromRow(db, row!);
}

/** What the model picked, or why it could not, and what that cost. */
export async function recordHighlights(db: Sql, id: number, outcome: ({ highlights: Highlight[] } | { error: string }) & { usage?: Usage }): Promise<void> {
  await db
    .update(digests)
    .set({
      ...('highlights' in outcome ? { highlights: sealJson(db, digestName(db, id), outcome.highlights) } : { error: outcome.error }),
      ...(outcome.usage ? { inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens, costUsd: outcome.usage.costUsd } : {}),
    })
    .where(eq(digests.id, id));
}

export async function digestInserted(db: Sql, id: number, gmailId: string, now: number): Promise<void> {
  await db.update(digests).set({ gmailId, insertedAt: now }).where(eq(digests.id, id));
}

/** Digests written down and not yet in Gmail, oldest first: a step cut off part-way, to finish. */
export async function openDigests(db: Sql): Promise<DigestRecord[]> {
  const rows = await db.select(RECORD).from(digests).where(isNull(digests.gmailId)).orderBy(asc(digests.id));
  return rows.map((r) => fromRow(db, r));
}

/** Of these messages in a mailbox, the digests Sift put there, once it knows Gmail's id for them. */
export async function knownDigests(db: Sql, accountId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ gmailId: digests.gmailId })
    .from(digests)
    .where(and(eq(digests.accountId, accountId), inArray(digests.gmailId, [...ids])));
  return new Set(rows.map((r) => r.gmailId!));
}

/** Whether a message with these headers (lowercased names) is a digest Sift wrote, by the Message-ID it gave it. */
export async function isOwnDigest(db: Sql, headers: Readonly<Record<string, string>>): Promise<boolean> {
  const id = headers['message-id']?.trim() ?? '';
  if (!DIGEST_ID.test(id)) return false;
  return (await db.select({ id: digests.id }).from(digests).where(eq(digests.messageId, id)).limit(1)).length > 0;
}

/** The label a digest is of, removed since or not. */
export async function labelOfDigest(db: Sql, labelId: string): Promise<DigestLabel> {
  const [row] = await db
    .select({ id: labels.id, name: labels.name, description: labels.description, gmailLabel: labels.gmailLabel })
    .from(labels)
    .where(eq(labels.id, labelId));
  return { ...row!, gmailLabel: row!.gmailLabel! };
}

/** A digest that will not go: its window opens again, and is due once there is something in it. */
export async function dropDigest(db: Sql, id: number): Promise<void> {
  await db.delete(digests).where(eq(digests.id, id));
}
