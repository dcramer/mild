import {
  type SQL,
  actions,
  alias,
  and,
  count,
  decisions,
  digests,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  messages,
  ne,
  or,
} from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { type Scope, within } from '../scope.ts';
import type { Saved } from '../types.ts';
import { DAY_MS } from './decisions.ts';

/**
 * What one message Sift took out of the inbox saved: about the time people spend on an email they open (Litmus's
 * measure, 9 to 13 seconds since 2011). Not its reading time: most of this mail is never read through, and counting
 * it as read would make the figure one nobody believes. The words in each message the model reads are recorded
 * (`Facts.words`) for when reading is estimated too.
 */
const GLANCE_SECONDS = 10;

export const saved = (messages: number): Saved => ({ messages, seconds: messages * GLANCE_SECONDS });

const first = alias(decisions, 'first');
const latest = alias(actions, 'latest');

/** Taking mail out of the inbox: archiving it, marking it spam, blocking its sender. */
const out = or(inArray(decisions.disposition, ['archive', 'spam']), eq(decisions.block, true))!;

/**
 * Mail Sift itself took out of the inbox, decided since `since` (and before `until`), with the label it gave: each
 * message once, by its latest change carried out, while that change stands and the reader never opened the
 * message. An answer of the reader's own is their attention, not Sift's; mail they opened anyway saved nothing.
 */
export async function keptOut(
  db: Sql,
  scope: Scope,
  since: number,
  { until, where }: { until?: number; where?: SQL } = {},
): Promise<{ decidedAt: number; labelId: string | null }[]> {
  return await db
    .select({ decidedAt: decisions.decidedAt, labelId: decisions.labelId })
    .from(decisions)
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .innerJoin(
      actions,
      eq(
        actions.id,
        db
          .select({ id: max(latest.id) })
          .from(latest)
          .where(and(eq(latest.decisionId, decisions.id), ne(latest.type, 'unsubscribe'))),
      ),
    )
    .where(
      and(
        within(scope, decisions.accountId),
        gte(decisions.decidedAt, since),
        until === undefined ? undefined : lt(decisions.decidedAt, until),
        eq(decisions.carryOut, true),
        eq(decisions.byUser, false),
        out,
        eq(actions.status, 'done'),
        isNull(messages.readAt),
        eq(
          decisions.id,
          db
            .select({ id: max(first.id) })
            .from(first)
            .where(and(eq(first.accountId, decisions.accountId), eq(first.messageId, decisions.messageId), eq(first.carryOut, true))),
        ),
        where,
      ),
    );
}

/**
 * `keptOut`, each message one, less one for each digest put back in the inbox since `since`, against its label when
 * it went in: a digest is one message back in the inbox for the many it lists.
 */
export async function keptOutLessDigests(db: Sql, scope: Scope, since: number): Promise<{ at: number; labelId: string | null; n: number }[]> {
  const put = await db
    .select({ at: digests.insertedAt, labelId: digests.labelId })
    .from(digests)
    .where(and(within(scope, digests.accountId), isNotNull(digests.insertedAt), gte(digests.insertedAt, since)));
  return [
    ...(await keptOut(db, scope, since)).map((k) => ({ at: k.decidedAt, labelId: k.labelId, n: 1 })),
    ...put.map((d) => ({ at: d.at ?? since, labelId: d.labelId, n: -1 })),
  ];
}

/** What `keptOutLessDigests` rows add up to, never below none. */
export const net = (rows: readonly { n: number }[]) =>
  Math.max(
    0,
    rows.reduce((sum, row) => sum + row.n, 0),
  );

/**
 * What Sift would have taken out of the inbox since `since` had it been on: each message's latest decision of
 * Sift's own, recorded only. Mail it was not sure of is `review`, so it is not counted.
 */
export async function wouldKeepOut(db: Sql, scope: Scope, since: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(decisions)
    .where(
      and(
        within(scope, decisions.accountId),
        gte(decisions.decidedAt, since),
        eq(decisions.byUser, false),
        eq(decisions.carryOut, false),
        out,
        eq(
          decisions.id,
          db
            .select({ id: max(first.id) })
            .from(first)
            .where(and(eq(first.accountId, decisions.accountId), eq(first.messageId, decisions.messageId), eq(first.byUser, false))),
        ),
      ),
    );
  return row?.n ?? 0;
}

const unsubscribedFrom = alias(messages, 'unsubscribed_from');

/**
 * Senders Sift unsubscribed from since `since`, and how much they had sent in the 30 days before: the mail a
 * month that stops coming.
 */
export async function unsubscribed(db: Sql, scope: Scope, since: number): Promise<{ senders: number; monthly: number }> {
  const done = await db
    .select({ accountId: actions.accountId, senderHash: unsubscribedFrom.senderHash, at: max(actions.createdAt) })
    .from(actions)
    .innerJoin(unsubscribedFrom, and(eq(unsubscribedFrom.accountId, actions.accountId), eq(unsubscribedFrom.id, actions.messageId)))
    .where(and(within(scope, actions.accountId), eq(actions.type, 'unsubscribe'), eq(actions.status, 'done'), gte(actions.createdAt, since)))
    .groupBy(actions.accountId, unsubscribedFrom.senderHash);
  let monthly = 0;
  for (const sender of done) {
    const at = sender.at ?? since;
    const [sent] = await db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.accountId, sender.accountId),
          eq(messages.senderHash, sender.senderHash),
          gte(messages.receivedAt, at - 30 * DAY_MS),
          lte(messages.receivedAt, at),
        ),
      );
    monthly += sent?.n ?? 0;
  }
  return { senders: done.length, monthly };
}
