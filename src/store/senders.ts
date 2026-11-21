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
  exists,
  feedback,
  inArray,
  isNotNull,
  max,
  messages,
  min,
  or,
  sql,
  type SQL,
} from './query.ts';
import type { Sql } from './sql.ts';
import { hashOf, hashCorrespondent, newestOfGroup, openNewest } from './content.ts';
import { parseListId } from '../triage/features.ts';
import type { FoundSender } from '../triage/rule-draft.ts';
import { type Standing, isSharedDomain, standingOf } from '../triage/standing.ts';
import { labelNames, listLabels } from './labels.ts';
import { listRules } from './rules.ts';
import { plain } from '../plain.ts';

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

const CORRESPONDENT_TTL_MS = 7 * 86_400_000;

/** The cached answer to "has the owner written to this address", or undefined if unknown or stale. A yes never goes stale. */
export async function cachedCorrespondent(db: Sql, accountId: string, address: string, now: number = Date.now()): Promise<boolean | undefined> {
  const [row] = await db
    .select({ userHasWritten: correspondents.userHasWritten, checkedAt: correspondents.checkedAt })
    .from(correspondents)
    .where(and(eq(correspondents.accountId, accountId), eq(correspondents.addressHash, hashOf(db, address))));
  if (!row) return undefined;
  if (row.userHasWritten) return true;
  return now - row.checkedAt < CORRESPONDENT_TTL_MS ? false : undefined;
}

export async function rememberCorrespondent(db: Sql, accountId: string, address: string, userHasWritten: boolean, now: number = Date.now()): Promise<void> {
  await db
    .insert(correspondents)
    .values({ accountId, ...hashCorrespondent(db, address), userHasWritten, checkedAt: now })
    .onConflictDoUpdate({
      target: [correspondents.userId, correspondents.accountId, correspondents.addressHash],
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

/** `contactOf` for many senders at once, over all of `accounts`, keyed by address. */
export async function contacts(db: Sql, accounts: readonly string[], addresses: readonly string[]): Promise<Map<string, Contact | null>> {
  if (addresses.length === 0 || accounts.length === 0) return new Map();
  const hashes = [...new Set(addresses.map((a) => hashOf(db, a)))];
  const seen = new Map<string, number>(
    (
      await db
        .select({ hash: messages.senderHash, n: count() })
        .from(messages)
        .where(and(inArray(messages.accountId, [...accounts]), inArray(messages.senderHash, hashes)))
        .groupBy(messages.senderHash)
    ).map((r) => [r.hash, r.n] as const),
  );
  const written = new Map<string, boolean | null>(
    (
      await db
        .select({ hash: correspondents.addressHash, yes: sql<boolean | null>`bool_or(${correspondents.userHasWritten})` })
        .from(correspondents)
        .where(and(inArray(correspondents.accountId, [...accounts]), inArray(correspondents.addressHash, hashes)))
        .groupBy(correspondents.addressHash)
    ).map((r) => [r.hash, r.yes] as const),
  );
  return new Map(
    addresses.map((address) => {
      const hash = hashOf(db, address);
      return [address, contactOf(seen.get(hash) ?? 0, written.get(hash) ?? null)] as const;
    }),
  );
}

/** What Mild knows about a sender, or about everyone at a domain. */
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
  /**
   * What the owner said their mail is, by an answer or a rule, by label id, most first. Unlike `labels`, no
   * model's guess: what the model is shown of a sender's history, so an early guess is not handed back to it as fact.
   */
  answered: { id: string; messages: number }[];
  /** Share of the mail the owner labelled that got the commonest label. Null with fewer than three labelled. */
  consistency: number | null;
  /** The owner's answers about their mail: Mild right, Mild wrong. */
  answers: { right: number; wrong: number };
  /** Whether the owner has written to them (for a domain: to anyone there). Null if not checked. */
  userHasWritten: boolean | null;
  contact: Contact | null;
  standing: Standing;
  why: string;
}

const MONTH_MS = 30 * 86_400_000;

async function facts(db: Sql, accounts: readonly string[], who: { address: string } | { domain: string }, now: number): Promise<SenderFacts> {
  const column = 'address' in who ? messages.senderHash : messages.domainHash;
  const value = 'address' in who ? who.address : who.domain;
  const hash = hashOf(db, value);
  const [seen] = (await db
    .select({
      n: count(),
      first: min(messages.receivedAt),
      last: max(messages.receivedAt),
      recent: sql<number>`count(*) FILTER (WHERE ${messages.receivedAt} >= ${now - MONTH_MS})`.mapWith(Number),
      senders: countDistinct(messages.senderHash),
    })
    .from(messages)
    .where(and(inArray(messages.accountId, [...accounts]), eq(column, hash)))) as [
    { n: number; first: number | null; last: number | null; recent: number; senders: number },
  ];
  const tally = async (also?: SQL) =>
    (await db
      .select({ id: decisions.labelId, messages: count() })
      .from(decisions)
      .innerJoin(messages, ofMessage(decisions))
      .where(and(inArray(decisions.accountId, [...accounts]), eq(column, hash), isNotNull(decisions.labelId), current(db), also))
      .groupBy(decisions.labelId)
      .orderBy(desc(count()), asc(decisions.labelId))) as SenderFacts['labels'];
  const labels = await tally();
  // An answer is recorded as a decision of the rules stage, as a rule's is; agreeing with Mild leaves its decision standing, with a `right` answer on it.
  const answered = await tally(
    or(
      eq(decisions.stage, 'rules'),
      exists(
        db
          .select({ id: feedback.id })
          .from(feedback)
          .where(and(eq(feedback.decisionId, decisions.id), eq(feedback.verdict, 'right'))),
      ),
    ),
  );
  const [answers] = (await db
    .select({
      right: sql<number>`count(*) FILTER (WHERE ${feedback.verdict} = 'right')`.mapWith(Number),
      wrong: sql<number>`count(*) FILTER (WHERE ${feedback.verdict} = 'wrong')`.mapWith(Number),
    })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .innerJoin(messages, ofMessage(decisions))
    .where(and(inArray(feedback.accountId, [...accounts]), eq(column, hash)))) as [{ right: number; wrong: number }];
  const [written] = await db
    .select({ yes: sql<boolean | null>`bool_or(${correspondents.userHasWritten})` })
    .from(correspondents)
    .where(and(inArray(correspondents.accountId, [...accounts]), eq('address' in who ? correspondents.addressHash : correspondents.domainHash, hash)));
  const userHasWritten = written?.yes ?? null;

  // Only a rule for exactly this sender or domain that decides by itself says how the owner regards them.
  const dispositions = new Map((await listLabels(db)).map((l) => [l.id, l.disposition]));
  // A rule naming them among others is about all of those senders, not how the owner regards this one.
  const only = (values: readonly string[] | undefined) => (values?.length === 1 ? values[0] : undefined);
  const rule = (await listRules(db)).find((r) => {
    const keys = Object.keys(r.match);
    return (
      keys.length === 1 &&
      r.whenLabel === undefined &&
      r.when === undefined &&
      ('address' in who ? only(r.match.from) === value : only(r.match.fromDomain) === value)
    );
  });
  const does = rule ? (rule.disposition ?? (rule.labelId ? dispositions.get(rule.labelId) : undefined)) : undefined;
  const labelled = answered.reduce((sum, l) => sum + l.messages, 0);
  const consistency = labelled >= 3 ? (answered[0]?.messages ?? 0) / labelled : null;
  return {
    messages: seen.n,
    firstSeenAt: seen.first,
    lastSeenAt: seen.last,
    recent: seen.recent,
    senders: seen.senders,
    labels,
    answered,
    consistency,
    answers,
    userHasWritten,
    contact: contactOf(seen.n, userHasWritten),
    ...standingOf({ userHasWritten, ruled: does === undefined || does === 'review' ? null : does, messages: seen.n, consistency }),
  };
}

/** What `accounts` hold of a sender's mail, together. */
export async function senderFacts(db: Sql, accounts: readonly string[], address: string, now: number = Date.now()): Promise<SenderFacts> {
  return await facts(db, accounts, { address }, now);
}

/** Null for a domain anyone can get an address at, which says nothing about its senders. */
export async function domainFacts(db: Sql, accounts: readonly string[], domain: string, now: number = Date.now()): Promise<SenderFacts | null> {
  return isSharedDomain(domain) ? null : await facts(db, accounts, { domain }, now);
}

const sent = alias(messages, 'sent');

/**
 * Everyone Mild has recorded mail from in a mailbox, with their newest mail's name, list and subject and
 * the label their newest labelled mail got. Senders are found only by keyed hash, so this reads one record
 * of each and the caller searches it.
 */
export async function senderDirectory(db: Sql, accounts: readonly string[]): Promise<FoundSender[]> {
  const names = await labelNames(db);
  const rows = await db
    .select({
      newest: newestOfGroup(),
      n: count(),
      label: sql<string | null>`${db
        .select({ id: decisions.labelId })
        .from(decisions)
        .innerJoin(sent, and(eq(sent.accountId, decisions.accountId), eq(sent.id, decisions.messageId)))
        .where(and(inArray(sent.accountId, [...accounts]), eq(sent.senderHash, messages.senderHash), isNotNull(decisions.labelId)))
        .orderBy(desc(decisions.id))
        .limit(1)}`,
    })
    .from(messages)
    .where(inArray(messages.accountId, [...accounts]))
    .groupBy(messages.senderHash)
    .orderBy(desc(count()), asc(messages.senderHash));
  return rows.map((r) => {
    const newest = plain(openNewest(db, r.newest));
    return {
      address: newest.fromAddress,
      name: newest.fromName,
      listId: parseListId(newest.headers['list-id']),
      messages: r.n,
      label: r.label === null ? null : (names.get(r.label) ?? null),
      subject: newest.subject,
    };
  });
}
