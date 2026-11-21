import { and, asc, conversationChanges, decisions, desc, eq, feedback, gt, inArray, lt, max, messages, or, sql } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { listAccounts } from '../../store/accounts.ts';
import { preferences } from '../../store/preferences.ts';
import { headOf } from '../../store/sync.ts';
import { openEnvelope } from '../../store/content.ts';
import { type Scope, within } from '../scope.ts';
import type { SyncPage, SyncedConversation } from '../types.ts';
import { previewsOf } from './mail.ts';

/**
 * The version of what a record holds. A cursor carries it, so a page holding records of another shape starts again: raise
 * it whenever `SyncedConversation` changes.
 */
const SHAPE = 1;
/** Changed conversations a reply carries at most. */
const CHANGES = 500;
/** Conversations a page of the whole copy carries: each is read whole, with its messages' headers opened. */
const SNAPSHOT = 200;

/** Where a page stands: past every change up to `seq`, or partway through the whole copy as it was at `seq`, after `after`. */
interface Cursor {
  shape: number;
  seq: number;
  after?: { at: number; accountId: string; threadId: string };
}

const write = (cursor: Omit<Cursor, 'shape'>) => Buffer.from(JSON.stringify({ shape: SHAPE, ...cursor })).toString('base64url');

function read(text: string | undefined): Cursor | null {
  if (!text) return null;
  try {
    const cursor = JSON.parse(Buffer.from(text, 'base64url').toString()) as Cursor;
    return cursor.shape === SHAPE && Number.isSafeInteger(cursor.seq) ? cursor : null;
  } catch {
    return null;
  }
}

const has = (label: string) => sql<boolean>`${messages.labelIds} @> ${JSON.stringify([label])}::jsonb`;
const key = (accountId: string, threadId: string) => `${accountId}\n${threadId}`;

/**
 * What changed in the person's copy since `since` (docs/sync.md). With no cursor, one from another shape or one older than
 * what is still remembered, the whole copy, a page at a time, newest first; after that, the conversations changed since,
 * in the order they changed, each as it is now.
 */
export async function syncPage(db: Sql, scope: Scope, since: string | undefined): Promise<SyncPage> {
  const head = await headOf(db);
  const mailboxes = (await listAccounts(db)).map((a) => a.id).filter((id) => scope.accounts.includes(id));
  const cursor = read(since);
  const behind = cursor === null || cursor.seq < head.purgedThrough || cursor.seq > head.seq;
  if (behind || cursor.after) {
    const from: Omit<Cursor, 'shape'> = behind ? { seq: head.seq } : cursor;
    const page = await wholeCopy(db, scope, from.after);
    const last = page.at(SNAPSHOT - 1);
    const more = page.length > SNAPSHOT;
    return {
      cursor: write({ seq: from.seq, ...(more && last ? { after: { at: last.at, accountId: last.accountId, threadId: last.threadId } } : {}) }),
      reset: behind,
      more,
      seq: from.seq,
      mailboxes,
      conversations: await conversations(db, scope, page.slice(0, SNAPSHOT)),
    };
  }
  const changed = await db
    .select({ accountId: conversationChanges.accountId, threadId: conversationChanges.threadId, seq: conversationChanges.seq })
    .from(conversationChanges)
    .where(and(within(scope, conversationChanges.accountId), gt(conversationChanges.seq, cursor.seq)))
    .orderBy(asc(conversationChanges.seq))
    .limit(CHANGES + 1);
  const shown = changed.slice(0, CHANGES);
  return {
    cursor: write({ seq: shown.at(-1)?.seq ?? cursor.seq }),
    reset: false,
    more: changed.length > CHANGES,
    seq: shown.at(-1)?.seq ?? cursor.seq,
    mailboxes,
    conversations: await conversations(db, scope, shown),
  };
}

/** A page of the conversations in the copy, newest first, after `after`, and one more to say whether there are others. */
async function wholeCopy(db: Sql, scope: Scope, after: Cursor['after']) {
  if (!(await preferences(db)).mail) return [];
  const threads = db
    .select({
      accountId: messages.accountId,
      threadId: messages.threadId,
      at: sql<number>`max(${messages.receivedAt})`.mapWith(Number).as('at'),
    })
    .from(messages)
    .where(and(within(scope, messages.accountId), has('INBOX')))
    .groupBy(messages.accountId, messages.threadId)
    .as('threads');
  return await db
    .select({ accountId: threads.accountId, threadId: threads.threadId, at: threads.at })
    .from(threads)
    .where(
      after
        ? or(
            lt(threads.at, after.at),
            and(
              eq(threads.at, after.at),
              or(lt(threads.accountId, after.accountId), and(eq(threads.accountId, after.accountId), lt(threads.threadId, after.threadId))),
            ),
          )
        : undefined,
    )
    .orderBy(desc(threads.at), desc(threads.accountId), desc(threads.threadId))
    .limit(SNAPSHOT + 1);
}

/**
 * Each conversation as the copy holds it, or null when it is not in the copy: Inbox is off, or none of its messages is in
 * the inbox now, or none is recorded any more.
 */
async function conversations(db: Sql, scope: Scope, wanted: readonly { accountId: string; threadId: string }[]): Promise<SyncPage['conversations']> {
  if (wanted.length === 0) return [];
  const on = (await preferences(db)).mail;
  const rows = on
    ? await db
        .select({
          accountId: messages.accountId,
          threadId: messages.threadId,
          id: messages.id,
          headers: messages.headers,
          receivedAt: messages.receivedAt,
          labelIds: messages.labelIds,
        })
        .from(messages)
        .where(and(within(scope, messages.accountId), inArray(messages.threadId, [...new Set(wanted.map((w) => w.threadId))])))
        .orderBy(asc(messages.receivedAt), asc(messages.id))
    : [];
  const byThread = new Map<string, typeof rows>();
  for (const r of rows) byThread.set(key(r.accountId, r.threadId), [...(byThread.get(key(r.accountId, r.threadId)) ?? []), r]);
  const held = wanted.flatMap((w) => {
    const all = byThread.get(key(w.accountId, w.threadId)) ?? [];
    return all.some((m) => m.labelIds.includes('INBOX')) ? [{ ...w, all }] : [];
  });
  const previews = await previewsOf(
    db,
    scope,
    held.flatMap((c) => c.all.map((m) => [c.accountId, m.id] as const)),
  );
  const thinks = await thinksOf(
    db,
    held.map((c) => [c.accountId, c.all.at(-1)!.id] as const),
  );
  const values = new Map(
    held.map((c): [string, SyncedConversation] => [
      key(c.accountId, c.threadId),
      {
        accountId: c.accountId,
        threadId: c.threadId,
        messages: c.all.map((m) => {
          const envelope = openEnvelope(db, m.accountId, m.id, { headers: m.headers });
          return {
            messageId: m.id,
            fromAddress: envelope.fromAddress,
            fromName: envelope.fromName,
            subject: envelope.subject,
            receivedAt: m.receivedAt,
            labelIds: m.labelIds,
            preview: previews.get(key(m.accountId, m.id)) ?? null,
          };
        }),
        thinks: thinks.get(key(c.accountId, c.all.at(-1)!.id)) ?? null,
      },
    ]),
  );
  return wanted.map((w) => ({ accountId: w.accountId, threadId: w.threadId, conversation: values.get(key(w.accountId, w.threadId)) ?? null }));
}

/** What Mild thinks of each message: its latest decision, or the person's answer about it where they gave one. */
async function thinksOf(db: Sql, newest: readonly (readonly [string, string])[]) {
  const thinks = new Map<string, NonNullable<SyncedConversation['thinks']>>();
  if (newest.length === 0) return thinks;
  const wanted = new Set(newest.map(([accountId, messageId]) => key(accountId, messageId)));
  const latest = db
    .select({ id: max(decisions.id).as('latest_id') })
    .from(decisions)
    .where(inArray(decisions.messageId, [...new Set(newest.map(([, messageId]) => messageId))]))
    .groupBy(decisions.accountId, decisions.messageId)
    .as('latest');
  const rows = await db
    .select({
      accountId: decisions.accountId,
      messageId: decisions.messageId,
      decisionId: decisions.id,
      disposition: decisions.disposition,
      block: decisions.block,
      digest: decisions.digest,
      labelId: decisions.labelId,
      stage: decisions.stage,
      confidence: decisions.confidence,
      answerId: feedback.id,
      answerDisposition: feedback.disposition,
      answerLabelId: feedback.labelId,
    })
    .from(decisions)
    .innerJoin(latest, eq(latest.id, decisions.id))
    .leftJoin(feedback, eq(feedback.decisionId, decisions.id));
  for (const r of rows) {
    if (!wanted.has(key(r.accountId, r.messageId))) continue;
    const answered = r.answerId !== null;
    thinks.set(key(r.accountId, r.messageId), {
      decisionId: r.decisionId,
      disposition: answered ? r.answerDisposition! : r.block ? 'block' : r.digest ? 'digest' : r.disposition,
      labelId: answered ? r.answerLabelId : r.labelId,
      stage: r.stage,
      confidence: answered ? null : r.confidence,
    });
  }
  return thinks;
}
