import {
  alias,
  and,
  asc,
  correspondents,
  count,
  countDistinct,
  decisions,
  desc,
  eq,
  feedback,
  ilike,
  inArray,
  isNotNull,
  max,
  messages,
  min,
  sql,
} from './query.ts';
import type { Sql } from './sql.ts';
import { type Standing, isSharedDomain, standingOf } from '../triage/standing.ts';
import type { Disposition } from '../triage/types.ts';
import { listLabels } from './labels.ts';
import { listRules } from './rules.ts';

const later = alias(decisions, 'later');

/** `decisions` is the current one for its message: the highest id. */
const current = (db: Sql) =>
  eq(
    decisions.id,
    db
      .select({ id: max(later.id) })
      .from(later)
      .where(and(eq(later.accountId, decisions.accountId), eq(later.messageId, decisions.messageId))),
  );

const ofMessage = (t: typeof decisions) => and(eq(messages.accountId, t.accountId), eq(messages.id, t.messageId));

/** What sift has recorded about mail from an address: how much, and what was done with it. */
export async function senderHistory(
  db: Sql,
  accountId: string,
  address: string,
): Promise<{ messagesSeen: number; pastDispositions: Partial<Record<Disposition, number>> }> {
  const [{ n }] = (await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.fromAddress, address)))) as [{ n: number }];
  // The current decision for each earlier message from this sender.
  const rows = await db
    .select({ disposition: decisions.disposition, n: count() })
    .from(decisions)
    .innerJoin(messages, ofMessage(decisions))
    .where(and(eq(decisions.accountId, accountId), eq(messages.fromAddress, address), current(db)))
    .groupBy(decisions.disposition);
  return { messagesSeen: n, pastDispositions: Object.fromEntries(rows.map((r) => [r.disposition, r.n])) };
}

const CORRESPONDENT_TTL_MS = 7 * 86_400_000;

/** The cached answer to "has the owner written to this address", or undefined if unknown or stale. A yes never goes stale. */
export async function cachedCorrespondent(db: Sql, accountId: string, address: string, now: number = Date.now()): Promise<boolean | undefined> {
  const [row] = await db
    .select({ userHasWritten: correspondents.userHasWritten, checkedAt: correspondents.checkedAt })
    .from(correspondents)
    .where(and(eq(correspondents.accountId, accountId), eq(correspondents.address, address)));
  if (!row) return undefined;
  if (row.userHasWritten) return true;
  return now - row.checkedAt < CORRESPONDENT_TTL_MS ? false : undefined;
}

export async function rememberCorrespondent(db: Sql, accountId: string, address: string, userHasWritten: boolean, now: number = Date.now()): Promise<void> {
  await db
    .insert(correspondents)
    .values({ accountId, address, userHasWritten, checkedAt: now })
    .onConflictDoUpdate({
      target: [correspondents.userId, correspondents.accountId, correspondents.address],
      set: { userHasWritten: sql`excluded.user_has_written`, checkedAt: sql`excluded.checked_at` },
    });
}

/**
 * How the owner and a sender know each other, from the mail alone: their first message, someone the owner
 * writes to, or someone who keeps writing and has never been written back to. Null for everyone else.
 */
export type Contact = 'new' | 'mutual' | 'one-way';

/** Messages from someone never written to before they count as one-way. */
const ONE_WAY_AFTER = 5;

export function contactOf(messages: number, userHasWritten: boolean | null): Contact | null {
  if (userHasWritten) return 'mutual';
  if (messages <= 1) return 'new';
  return messages >= ONE_WAY_AFTER && userHasWritten === false ? 'one-way' : null;
}

/** `contactOf` for many senders at once, keyed by account and address (`account\naddress`). */
export async function contacts(db: Sql, senders: { accountId: string; address: string }[]): Promise<Map<string, Contact | null>> {
  if (senders.length === 0) return new Map();
  const accounts = [...new Set(senders.map((s) => s.accountId))];
  const addresses = [...new Set(senders.map((s) => s.address))];
  const seen = new Map<string, number>(
    (
      await db
        .select({ accountId: messages.accountId, address: messages.fromAddress, n: count() })
        .from(messages)
        .where(and(inArray(messages.accountId, accounts), inArray(messages.fromAddress, addresses)))
        .groupBy(messages.accountId, messages.fromAddress)
    ).map((r) => [`${r.accountId}\n${r.address}`, r.n] as const),
  );
  const written = new Map<string, boolean>(
    (
      await db
        .select({ accountId: correspondents.accountId, address: correspondents.address, yes: correspondents.userHasWritten })
        .from(correspondents)
        .where(and(inArray(correspondents.accountId, accounts), inArray(correspondents.address, addresses)))
    ).map((r) => [`${r.accountId}\n${r.address}`, r.yes] as const),
  );
  return new Map(
    senders.map(({ accountId, address }) => {
      const key = `${accountId}\n${address}`;
      return [key, contactOf(seen.get(key) ?? 0, written.get(key) ?? null)] as const;
    }),
  );
}

/** What sift knows about a sender, or about everyone at a domain. */
export interface SenderFacts {
  messages: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  /** Messages in the last 30 days. */
  recent: number;
  /** For a domain: how many addresses have written from it. */
  senders: number;
  /** What their mail currently is, by label id, most first. */
  labels: { id: string; messages: number }[];
  /** Share of labelled mail that got the commonest label. Null with fewer than three labelled. */
  consistency: number | null;
  /** The owner's answers about their mail: sift right, sift wrong. */
  answers: { right: number; wrong: number };
  /** Whether the owner has written to them (for a domain: to anyone there). Null if not checked. */
  userHasWritten: boolean | null;
  contact: Contact | null;
  standing: Standing;
  why: string;
}

const MONTH_MS = 30 * 86_400_000;

async function facts(db: Sql, accountId: string, who: { address: string } | { domain: string }, now: number): Promise<SenderFacts> {
  const column = 'address' in who ? messages.fromAddress : messages.fromDomain;
  const value = 'address' in who ? who.address : who.domain;
  const [seen] = (await db
    .select({
      n: count(),
      first: min(messages.receivedAt),
      last: max(messages.receivedAt),
      recent: sql<number>`count(*) FILTER (WHERE ${messages.receivedAt} >= ${now - MONTH_MS})`.mapWith(Number),
      senders: countDistinct(messages.fromAddress),
    })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(column, value)))) as [
    { n: number; first: number | null; last: number | null; recent: number; senders: number },
  ];
  const labels = (await db
    .select({ id: decisions.labelId, messages: count() })
    .from(decisions)
    .innerJoin(messages, ofMessage(decisions))
    .where(and(eq(decisions.accountId, accountId), eq(column, value), isNotNull(decisions.labelId), current(db)))
    .groupBy(decisions.labelId)
    .orderBy(desc(count()), asc(decisions.labelId))) as SenderFacts['labels'];
  const [answers] = (await db
    .select({
      right: sql<number>`count(*) FILTER (WHERE ${feedback.verdict} = 'right')`.mapWith(Number),
      wrong: sql<number>`count(*) FILTER (WHERE ${feedback.verdict} = 'wrong')`.mapWith(Number),
    })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .innerJoin(messages, ofMessage(decisions))
    .where(and(eq(feedback.accountId, accountId), eq(column, value)))) as [{ right: number; wrong: number }];
  const [written] =
    'address' in who
      ? await db
          .select({ yes: correspondents.userHasWritten })
          .from(correspondents)
          .where(and(eq(correspondents.accountId, accountId), eq(correspondents.address, value)))
      : await db
          .select({ yes: sql<boolean | null>`bool_or(${correspondents.userHasWritten})` })
          .from(correspondents)
          .where(and(eq(correspondents.accountId, accountId), ilike(correspondents.address, `%@${value}`)));
  const userHasWritten = written?.yes ?? null;

  // Only a rule for exactly this sender or domain that decides by itself says how the owner regards them.
  const dispositions = new Map((await listLabels(db, accountId)).map((l) => [l.id, l.disposition]));
  const rule = (await listRules(db, accountId)).find((r) => {
    const keys = Object.keys(r.match);
    return keys.length === 1 && r.whenLabel === undefined && r.when === undefined && ('address' in who ? r.match.from === value : r.match.fromDomain === value);
  });
  const does = rule ? (rule.disposition ?? (rule.labelId ? dispositions.get(rule.labelId) : undefined)) : undefined;
  const labelled = labels.reduce((sum, l) => sum + l.messages, 0);
  const consistency = labelled >= 3 ? (labels[0]?.messages ?? 0) / labelled : null;
  return {
    messages: seen.n,
    firstSeenAt: seen.first,
    lastSeenAt: seen.last,
    recent: seen.recent,
    senders: seen.senders,
    labels,
    consistency,
    answers,
    userHasWritten,
    contact: contactOf(seen.n, userHasWritten),
    ...standingOf({ userHasWritten, ruled: does === undefined || does === 'review' ? null : does, messages: seen.n, consistency }),
  };
}

export async function senderFacts(db: Sql, accountId: string, address: string, now: number = Date.now()): Promise<SenderFacts> {
  return await facts(db, accountId, { address }, now);
}

/** Null for a domain anyone can get an address at, which says nothing about its senders. */
export async function domainFacts(db: Sql, accountId: string, domain: string, now: number = Date.now()): Promise<SenderFacts | null> {
  return isSharedDomain(domain) ? null : await facts(db, accountId, { domain }, now);
}
