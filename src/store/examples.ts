import { type SQL, and, asc, desc, eq, examples, isNotNull, lt, lte, messages, sql } from './query.ts';
import type { Sql } from './sql.ts';
import { MAX_SHOTS, type Shot, excerptOf } from '../triage/fewshot.ts';
import type { MessageFacts } from '../triage/types.ts';

const SHOT = {
  messageId: examples.messageId,
  fromAddress: messages.fromAddress,
  fromDomain: messages.fromDomain,
  fromName: messages.fromName,
  subject: messages.subject,
  start: sql<string | null>`substr(${examples.bodyText}, 1, 2000)`.as('start'),
  labelId: examples.labelId,
  markedAt: examples.markedAt,
};

const withMessage = and(eq(messages.accountId, examples.accountId), eq(messages.id, examples.messageId));

/**
 * Stored examples that might help judge `facts`: the newest from its sender, from its sender's domain,
 * and of each label. More than the prompt takes; `pickShots` chooses among them.
 */
export async function shotCandidates(db: Sql, facts: Pick<MessageFacts, 'accountId' | 'from'>): Promise<Shot[]> {
  // One more than the prompt takes, so leaving out the message under judgement still fills it.
  const limit = MAX_SHOTS + 1;
  const captured = (also?: SQL) => and(eq(examples.accountId, facts.accountId), eq(examples.status, 'captured'), isNotNull(examples.labelId), also);
  const newest = (also: SQL) =>
    db
      .select(SHOT)
      .from(examples)
      .innerJoin(messages, withMessage)
      .where(captured(also))
      .orderBy(desc(examples.markedAt), asc(examples.messageId))
      .limit(limit);
  const ranked = db
    .select({
      ...SHOT,
      nth: sql<number>`row_number() OVER (PARTITION BY ${examples.labelId} ORDER BY ${examples.markedAt} DESC, ${examples.messageId})`.as('nth'),
    })
    .from(examples)
    .innerJoin(messages, withMessage)
    .where(captured())
    .as('ranked');
  const rows = [
    ...(await newest(eq(messages.fromAddress, facts.from.address))),
    ...(await newest(eq(messages.fromDomain, facts.from.domain))),
    ...(await db.select().from(ranked).where(lte(ranked.nth, 2))),
  ];
  return [...new Map(rows.map((r) => [r.messageId, r] as const)).values()].map((r) => ({
    messageId: r.messageId,
    fromAddress: r.fromAddress,
    fromDomain: r.fromDomain,
    ...(r.fromName ? { fromName: r.fromName } : {}),
    subject: r.subject,
    excerpt: excerptOf(r.start ?? ''),
    labelId: r.labelId!,
    markedAt: r.markedAt,
  }));
}

export interface StoredExample {
  accountId: string;
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  /** The user's answer. */
  labelId: string | null;
  markedAt: number;
  status: 'pending' | 'captured' | 'gone';
}

/** What is held as examples, newest answers first, without the content. */
export async function listExamples(db: Sql, accountId?: string, limit = 500): Promise<StoredExample[]> {
  return (await db
    .select({
      accountId: examples.accountId,
      messageId: examples.messageId,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      subject: messages.subject,
      labelId: examples.labelId,
      markedAt: examples.markedAt,
      status: examples.status,
    })
    .from(examples)
    .innerJoin(messages, withMessage)
    .where(accountId === undefined ? undefined : eq(examples.accountId, accountId))
    .orderBy(desc(examples.markedAt), asc(examples.messageId))
    .limit(limit)) as StoredExample[];
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

/** Delete examples the user answered for more than `keepDays` days ago. Returns how many were deleted. */
export async function pruneExamples(db: Sql, keepDays: number, now: number = Date.now()): Promise<number> {
  return (
    await db
      .delete(examples)
      .where(lt(examples.markedAt, now - keepDays * 86_400_000))
      .returning({ messageId: examples.messageId })
  ).length;
}
