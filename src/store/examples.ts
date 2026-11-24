import { type SQL, and, asc, count, desc, eq, examples, inArray, isNotNull, lt, lte, messages, sql } from './query.ts';
import type { EXAMPLE_STATUSES } from './states.ts';
import type { Sql } from './sql.ts';
import { exampleKeys, hashOf, openEnvelope, openFacts, openPart } from './content.ts';
import { type Candidate, PER_LOOKUP, type Shot, excerptOf, nameKey, pickShots, withinBudget } from '../triage/fewshot.ts';
import { isSharedDomain } from '../triage/standing.ts';
import type { Address, Label, MessageFacts } from '../triage/types.ts';
import { plain } from '../plain.ts';
import type { Confidential } from '../confidential.ts';

const CANDIDATE = {
  messageId: examples.messageId,
  headers: messages.headers,
  facts: messages.facts,
  labelId: examples.labelId,
  markedAt: examples.markedAt,
};

const withMessage = and(eq(messages.accountId, examples.accountId), eq(messages.id, examples.messageId));

/**
 * The examples the model is shown beside `facts` (`pickShots`): found by index, a few at a time, as the newest
 * under the same sender name, with the same kind of subject, from the same sender, from the same domain, and
 * of each label, answered before `before` when it is given. Only the ones picked have their text read.
 */
export async function examplesFor(
  db: Sql,
  facts: Pick<MessageFacts, 'accountId' | 'messageId' | 'from' | 'subject'>,
  labels: readonly Label[],
  before?: number,
): Promise<Shot[]> {
  const { nameHash, subjectHash } = exampleKeys(db, facts);
  const captured = (also?: SQL) =>
    and(
      eq(examples.accountId, facts.accountId),
      eq(examples.status, 'captured'),
      isNotNull(examples.labelId),
      before === undefined ? undefined : lt(examples.markedAt, before),
      also,
    );
  // One more than each lookup gives, so leaving out the message under judgement still fills it.
  const newest = async (also: SQL) =>
    await db
      .select(CANDIDATE)
      .from(examples)
      .innerJoin(messages, withMessage)
      .where(captured(also))
      .orderBy(desc(examples.markedAt), asc(examples.messageId))
      .limit(PER_LOOKUP + 1);
  // Ranked on the examples alone, so only the few kept are joined to their messages.
  const ranked = db
    .select({
      messageId: examples.messageId,
      nth: sql<number>`row_number() OVER (PARTITION BY ${examples.labelId} ORDER BY ${examples.markedAt} DESC, ${examples.messageId})`.as('nth'),
    })
    .from(examples)
    .where(captured())
    .as('ranked');
  const rows = [
    ...(nameHash === null ? [] : await newest(eq(examples.nameHash, nameHash))),
    ...(subjectHash === null ? [] : await newest(eq(examples.subjectHash, subjectHash))),
    ...(await newest(eq(messages.senderHash, hashOf(db, facts.from.address)))),
    ...(isSharedDomain(facts.from.domain) ? [] : await newest(eq(messages.domainHash, hashOf(db, facts.from.domain)))),
    ...(await db
      .select(CANDIDATE)
      .from(ranked)
      .innerJoin(examples, and(eq(examples.accountId, facts.accountId), eq(examples.messageId, ranked.messageId)))
      .innerJoin(messages, withMessage)
      .where(lte(ranked.nth, PER_LOOKUP))),
  ];
  const candidates = [...new Map(rows.map((r) => [r.messageId, plain(openEnvelope(db, facts.accountId, r.messageId, r))] as const)).values()].map(
    (r): Candidate => ({
      messageId: r.messageId,
      fromAddress: r.fromAddress,
      fromDomain: r.fromDomain,
      ...(r.fromName ? { fromName: r.fromName } : {}),
      subject: r.subject,
      facts: openFacts(r.facts, r.headers),
      labelId: r.labelId!,
      markedAt: r.markedAt,
    }),
  );
  const picked = pickShots(candidates, facts, labels);
  if (picked.length === 0) return [];
  const bodies = new Map(
    (
      await db
        .select({ messageId: examples.messageId, body: examples.bodyText })
        .from(examples)
        .where(
          and(
            eq(examples.accountId, facts.accountId),
            inArray(
              examples.messageId,
              picked.map((p) => p.messageId),
            ),
          ),
        )
    ).map((r) => [r.messageId, r.body]),
  );
  return withinBudget(
    picked.map((p) => ({
      ...p,
      excerpt: excerptOf(plain(openPart(db, facts.accountId, p.messageId, 'text', bodies.get(p.messageId) ?? null))?.slice(0, 2000) ?? ''),
    })),
  );
}

/** How the owner answered for earlier mail under the same sender name as `from`, by label, most first. */
export async function answersUnderName(db: Sql, accountId: string, from: Address): Promise<{ id: string; messages: number }[]> {
  const name = nameKey(from);
  if (name === null) return [];
  return (await db
    .select({ id: examples.labelId, messages: count() })
    .from(examples)
    .where(and(eq(examples.accountId, accountId), eq(examples.status, 'captured'), eq(examples.nameHash, hashOf(db, name)), isNotNull(examples.labelId)))
    .groupBy(examples.labelId)
    .orderBy(desc(count()), asc(examples.labelId))) as { id: string; messages: number }[];
}

interface StoredExample {
  accountId: string;
  messageId: string;
  fromAddress: Confidential;
  fromName: Confidential | null;
  subject: Confidential;
  /** The user's answer. */
  labelId: string | null;
  markedAt: number;
  status: (typeof EXAMPLE_STATUSES)[number];
}

/** What is held as examples, newest answers first, without the content. */
export async function listExamples(db: Sql, accountId?: string, limit = 500): Promise<StoredExample[]> {
  const rows = await db
    .select({
      accountId: examples.accountId,
      messageId: examples.messageId,
      headers: messages.headers,
      labelId: examples.labelId,
      markedAt: examples.markedAt,
      status: examples.status,
    })
    .from(examples)
    .innerJoin(messages, withMessage)
    .where(accountId === undefined ? undefined : eq(examples.accountId, accountId))
    .orderBy(desc(examples.markedAt), asc(examples.messageId))
    .limit(limit);
  return rows.map((r) => openEnvelope(db, r.accountId, r.messageId, r));
}

/**
 * Delete stored examples: one message's, or all of an account's. The stored message goes; the user's
 * answer stays in `feedback`, and so does any rule it made. Returns how many were deleted.
 */
export async function deleteExamples(db: Sql, accountId: string, messageId?: string): Promise<number> {
  const deleted = await db
    .delete(examples)
    .where(and(eq(examples.accountId, accountId), messageId === undefined ? undefined : eq(examples.messageId, messageId)))
    .returning({ messageId: examples.messageId });
  return deleted.length;
}

/** An example holds a whole message, so it is not kept for ever; a year of answers is plenty to learn from. */
export const EXAMPLE_KEEP_DAYS = 365;

/** Delete examples the user answered for more than `EXAMPLE_KEEP_DAYS` ago. Returns how many were deleted. */
export async function pruneExamples(db: Sql, now: number = Date.now()): Promise<number> {
  return (
    await db
      .delete(examples)
      .where(lt(examples.markedAt, now - EXAMPLE_KEEP_DAYS * 86_400_000))
      .returning({ messageId: examples.messageId })
  ).length;
}
