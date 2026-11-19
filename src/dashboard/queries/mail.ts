import {
  type AnyColumn,
  type SQL,
  alias,
  and,
  asc,
  decisions,
  desc,
  eq,
  exists,
  feedback,
  gte,
  inArray,
  isNull,
  lt,
  mailBodies,
  max,
  messages,
  or,
  sql,
  suggestionBodies,
} from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { listAccounts } from '../../store/accounts.ts';
import { listLabels } from '../../store/labels.ts';
import { hashOf, openEnvelope, openPart } from '../../store/content.ts';
import { type Scope, within } from '../scope.ts';
import { Refusal } from '../../refusal.ts';
import type { MailConversation, MailThread, MailThreads, MailView } from '../types.ts';
import { plain, seal } from '../../plain.ts';
import type { Confidential } from '../../confidential.ts';

/** About a screen's worth of conversations, so a page arrives in one read and scrolling loads the next. */
const PAGE = 50;
/**
 * How many conversations one search reads through, newest first: what it matches is in encrypted headers, so each is
 * opened here. A search that matched fewer than a page by then answers what it has, with `next` to go on from.
 */
const SEARCH_REACH = 500;
const PREVIEW_CHARS = 400;

const has = (labelIds: SQL | AnyColumn, label: string) => sql<boolean>`${labelIds} @> ${JSON.stringify([label])}::jsonb`;

/** `newestAt.threadId`: where a page ended. Thread ids are Gmail's, letters and digits. */
const CURSOR = /^(\d+)\.([\w-]+)$/;

export interface ThreadQuery {
  view: MailView;
  label?: string | undefined;
  q?: string | undefined;
  unread?: boolean;
  before?: string | undefined;
  /** Senders, any of which wrote a message of the conversation: addresses, and domains for everyone at one. */
  from?: readonly string[];
  domain?: readonly string[];
  /** The newest message came on or after it. */
  since?: number | undefined;
  /** Words, any of which a subject of the conversation has. */
  subject?: readonly string[];
}

/** The conversations that have mail in the inbox now, newest first, a page at a time. */
export async function listThreads(db: Sql, scope: Scope, query: ThreadQuery): Promise<MailThreads> {
  const inInbox = alias(messages, 'in_inbox');
  const threads = db
    .select({
      accountId: messages.accountId,
      threadId: messages.threadId,
      newestAt: sql<number>`max(${messages.receivedAt})`.mapWith(Number).as('newest_at'),
      newestId: sql<string>`(array_agg(${messages.id} ORDER BY ${messages.receivedAt} DESC, ${messages.id} DESC))[1]`.as('newest_id'),
      unread: sql<boolean>`bool_or(${has(messages.labelIds, 'UNREAD')})`.as('unread'),
    })
    .from(messages)
    .where(
      and(
        within(scope, messages.accountId),
        exists(
          db
            .select({ one: sql`1` })
            .from(inInbox)
            .where(and(eq(inInbox.accountId, messages.accountId), eq(inInbox.threadId, messages.threadId), has(inInbox.labelIds, 'INBOX'))),
        ),
      ),
    )
    .groupBy(messages.accountId, messages.threadId)
    .as('threads');
  const later = alias(decisions, 'later');
  // The reader's answer about it, where they gave one, beats what Sift decided.
  const answered = sql`${feedback.id} IS NOT NULL`;
  const labelId = sql<string | null>`CASE WHEN ${answered} THEN ${feedback.labelId} ELSE ${decisions.labelId} END`;
  const disposition = sql<string | null>`CASE WHEN ${answered} THEN ${feedback.disposition} ELSE ${decisions.disposition} END`;
  const cursor = query.before === undefined ? null : CURSOR.exec(query.before);
  const needle = query.q?.trim().toLowerCase() ?? '';
  const words = (query.subject ?? []).map((w) => w.toLowerCase());
  // What matches is in encrypted headers, opened here: a search reads through the newest conversations.
  const scanning = needle !== '' || words.length > 0;
  const senders = [
    ...(query.from ?? []).map((a) => [hashOf(db, a), 'sender'] as const),
    ...(query.domain ?? []).map((d) => [hashOf(db, d), 'domain'] as const),
  ];
  const sent = alias(messages, 'sent');
  const rows = await db
    .select({
      accountId: threads.accountId,
      threadId: threads.threadId,
      newestAt: threads.newestAt,
      newestId: threads.newestId,
      unread: threads.unread,
      decisionId: decisions.id,
      answered: sql<boolean>`${answered}`,
      disposition,
      block: decisions.block,
      digest: decisions.digest,
      labelId,
      stage: decisions.stage,
      confidence: decisions.confidence,
    })
    .from(threads)
    .leftJoin(
      decisions,
      and(
        eq(decisions.accountId, threads.accountId),
        eq(decisions.messageId, threads.newestId),
        eq(
          decisions.id,
          db
            .select({ id: max(later.id) })
            .from(later)
            .where(and(eq(later.accountId, threads.accountId), eq(later.messageId, threads.newestId))),
        ),
      ),
    )
    .leftJoin(feedback, eq(feedback.decisionId, decisions.id))
    .where(
      and(
        cursor ? or(lt(threads.newestAt, Number(cursor[1])), and(eq(threads.newestAt, Number(cursor[1])), lt(threads.threadId, cursor[2]!))) : undefined,
        query.label ? sql`${labelId} = ${query.label}` : undefined,
        query.view === 'needs' ? or(isNull(decisions.id), sql`${disposition} IN ('keep', 'review')`) : undefined,
        query.view === 'sorted' ? sql`${disposition} IN ('archive', 'spam')` : undefined,
        query.unread ? eq(threads.unread, true) : undefined,
        query.since === undefined ? undefined : gte(threads.newestAt, query.since),
        senders.length > 0
          ? exists(
              db
                .select({ one: sql`1` })
                .from(sent)
                .where(
                  and(
                    eq(sent.accountId, threads.accountId),
                    eq(sent.threadId, threads.threadId),
                    or(...senders.map(([hash, by]) => eq(by === 'sender' ? sent.senderHash : sent.domainHash, hash))),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(threads.newestAt), desc(threads.threadId))
    .limit((scanning ? SEARCH_REACH : PAGE) + 1);

  const scanned = rows.slice(0, scanning ? SEARCH_REACH : PAGE);
  const inThreads = await threadMessages(
    db,
    scope,
    scanned.map((r) => [r.accountId, r.threadId] as const),
  );
  const matches = scanning
    ? scanned.filter((r) => {
        const all = inThreads.get(`${r.accountId}\n${r.threadId}`) ?? [];
        return (
          (needle === '' || all.some((m) => [m.fromAddress, m.fromName ?? '', m.subject].some((text) => plain(text).toLowerCase().includes(needle)))) &&
          (words.length === 0 || all.some((m) => words.some((w) => plain(m.subject).toLowerCase().includes(w))))
        );
      })
    : scanned;
  const shown = matches.slice(0, PAGE);
  const last = matches.length > PAGE ? shown.at(-1) : rows.length > scanned.length ? scanned.at(-1) : undefined;

  const names = new Map((await listLabels(db)).map((l) => [l.id, l.name] as const));
  const mine = new Set((await listAccounts(db)).map((a) => a.id));
  const previews = await previewsOf(
    db,
    shown.map((r) => [r.accountId, r.newestId] as const),
  );
  return {
    threads: shown.map((r): MailThread => {
      const all = inThreads.get(`${r.accountId}\n${r.threadId}`) ?? [];
      const newest = all.at(-1)!;
      const who = [...new Set(all.map((m) => (mine.has(plain(m.fromAddress)) ? 'me' : plain(m.fromName ?? m.fromAddress))))];
      return {
        accountId: r.accountId,
        threadId: r.threadId,
        subject: newest.subject,
        who: seal(who),
        messageIds: all.map((m) => m.messageId),
        unread: r.unread,
        newestAt: r.newestAt,
        preview: previews.get(`${r.accountId}\n${r.newestId}`) ?? null,
        thinks:
          r.decisionId === null
            ? null
            : {
                decisionId: r.decisionId,
                disposition: r.answered ? r.disposition! : r.block ? 'block' : r.digest ? 'digest' : r.disposition!,
                labelId: r.labelId,
                labelName: (r.labelId && names.get(r.labelId)) ?? null,
                stage: r.stage!,
                confidence: r.answered ? null : r.confidence,
              },
      };
    }),
    next: last ? `${last.newestAt}.${last.threadId}` : null,
  };
}

/** The recorded messages of these conversations, oldest first, by `account\nthread`. */
async function threadMessages(db: Sql, scope: Scope, threads: readonly (readonly [string, string])[]) {
  const wanted = new Set(threads.map(([account, thread]) => `${account}\n${thread}`));
  const byThread = new Map<string, ReturnType<typeof open>[]>();
  if (wanted.size === 0) return byThread;
  const open = (r: { accountId: string; id: string; headers: string; receivedAt: number; labelIds: string[] }) => ({
    messageId: r.id,
    receivedAt: r.receivedAt,
    unread: r.labelIds.includes('UNREAD'),
    ...openEnvelope(db, r.accountId, r.id, { headers: r.headers }),
  });
  const rows = await db
    .select({
      accountId: messages.accountId,
      threadId: messages.threadId,
      id: messages.id,
      headers: messages.headers,
      receivedAt: messages.receivedAt,
      labelIds: messages.labelIds,
    })
    .from(messages)
    .where(and(within(scope, messages.accountId), inArray(messages.threadId, [...new Set(threads.map(([, thread]) => thread))])))
    .orderBy(asc(messages.receivedAt), asc(messages.id));
  for (const r of rows) {
    const key = `${r.accountId}\n${r.threadId}`;
    if (!wanted.has(key)) continue;
    byThread.set(key, [...(byThread.get(key) ?? []), open(r)]);
  }
  return byThread;
}

/** The start of each message's text, on one line: Inbox's whole copy, or else the copy kept while it waits on the reader. */
async function previewsOf(db: Sql, wanted: readonly (readonly [string, string])[]) {
  const previews = new Map<string, Confidential>();
  if (wanted.length === 0) return previews;
  const ids = [...new Set(wanted.map(([, id]) => id))];
  const keys = new Set(wanted.map(([account, id]) => `${account}\n${id}`));
  for (const table of [suggestionBodies, mailBodies]) {
    const rows = await db
      .select({ accountId: table.accountId, messageId: table.messageId, text: table.bodyText })
      .from(table)
      .where(inArray(table.messageId, ids));
    for (const r of rows) {
      const key = `${r.accountId}\n${r.messageId}`;
      if (!keys.has(key)) continue;
      const text = plain(openPart(db, r.accountId, r.messageId, 'text', r.text) ?? '');
      previews.set(key, seal(text.slice(0, PREVIEW_CHARS).replace(/\s+/g, ' ').trim()));
    }
  }
  return previews;
}

/**
 * Which of the scope's mailboxes holds the conversation with Gmail's id `threadId`, or null when none does. Like a
 * message's (`mailboxOf`, queries/messages.ts), two mailboxes could hold the same id: then the request must name one.
 */
async function threadMailbox(db: Sql, scope: Scope, threadId: string): Promise<string | null> {
  const found = await db
    .selectDistinct({ accountId: messages.accountId })
    .from(messages)
    .where(and(within(scope, messages.accountId), eq(messages.threadId, threadId)));
  if (found.length > 1) throw new Refusal('More than one of your mailboxes has a conversation with that id; say which.');
  return found[0]?.accountId ?? null;
}

/** One conversation's recorded messages, oldest first, in whichever of the scope's mailboxes holds it, or null when none does. */
export async function conversation(db: Sql, scope: Scope, threadId: string): Promise<MailConversation | null> {
  const accountId = await threadMailbox(db, scope, threadId);
  if (accountId === null) return null;
  const listed = (await threadMessages(db, scope, [[accountId, threadId]])).get(`${accountId}\n${threadId}`) ?? [];
  if (listed.length === 0) return null;
  const previews = await previewsOf(
    db,
    listed.map((m) => [accountId, m.messageId] as const),
  );
  return {
    accountId,
    threadId,
    messages: listed.map((m) => ({
      messageId: m.messageId,
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      receivedAt: m.receivedAt,
      unread: m.unread,
      preview: previews.get(`${accountId}\n${m.messageId}`) ?? null,
    })),
  };
}
