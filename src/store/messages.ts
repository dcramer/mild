import { type SQL, and, asc, decisions, desc, eq, lt, messages, not, notExists, or, sql, suggestionBodies } from './query.ts';
import { outOfTries } from './runs.ts';
import type { Sql } from './sql.ts';
import type { Facts, RuleFacts } from '../triage/facts.ts';
import type { Address, MessageFacts } from '../triage/types.ts';

const COLUMNS = {
  id: messages.id,
  threadId: messages.threadId,
  fromAddress: messages.fromAddress,
  fromDomain: messages.fromDomain,
  fromName: messages.fromName,
  receivedAt: messages.receivedAt,
  subject: messages.subject,
  to: messages.to,
  cc: messages.cc,
  headers: messages.headers,
  labelIds: messages.labelIds,
  suggestOnly: messages.suggestOnly,
  facts: messages.facts,
};

interface Row {
  id: string;
  threadId: string;
  fromAddress: string;
  fromDomain: string;
  fromName: string | null;
  receivedAt: number;
  subject: string;
  to: Address[];
  cc: Address[];
  headers: Record<string, string>;
  labelIds: string[];
  suggestOnly: boolean;
  facts: Facts;
}

const toMessage = (accountId: string, r: Row): MessageFacts => ({
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
  known: r.facts,
});

interface QueuedMessage {
  facts: MessageFacts;
  /** Pulled in from before sift was connected: suggest, never act. */
  suggestOnly: boolean;
}

/**
 * Recorded messages that have no decision yet, newest first, rebuilt as triage input. This is the triage queue.
 * Newest first because mail can wait in it (with no model, what no rule covers is left there), and what waits
 * must never keep new mail from being classified. Mail the model has failed on `MAX_ATTEMPTS` times is left out until the user puts it back.
 */
export async function listUndecided(db: Sql, accountId: string, limit: number): Promise<QueuedMessage[]> {
  const rows = await db
    .select(COLUMNS)
    .from(messages)
    .where(
      and(
        eq(messages.accountId, accountId),
        notExists(
          db
            .select({ id: decisions.id })
            .from(decisions)
            .where(and(eq(decisions.accountId, messages.accountId), eq(decisions.messageId, messages.id))),
        ),
        not(outOfTries(db, messages.accountId, messages.id)),
      ),
    )
    .orderBy(desc(messages.receivedAt), asc(messages.id))
    .limit(limit);
  return rows.map((r) => ({ suggestOnly: r.suggestOnly, facts: toMessage(accountId, r) }));
}

/** The facts recorded for a message, or null if sift has not seen it. */
export async function storedFacts(db: Sql, accountId: string, messageId: string): Promise<Facts | null> {
  const [row] = await db
    .select({ facts: messages.facts })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  return row?.facts ?? null;
}

/** Replace a message's recorded facts, once reading the whole message has added to them. */
export async function recordFacts(db: Sql, accountId: string, messageId: string, facts: Facts): Promise<void> {
  await db
    .update(messages)
    .set({ facts })
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
}

/** One recorded message as triage input, or null if sift never saw it. */
export async function getFacts(db: Sql, accountId: string, messageId: string): Promise<MessageFacts | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  return row ? toMessage(accountId, row) : null;
}

/** Delete the text of waiting mail fetched before `cutoff`, every mailbox's. Returns how many went. */
export async function purgeSuggestionBodies(db: Sql, cutoff: number): Promise<number> {
  return (await db.delete(suggestionBodies).where(lt(suggestionBodies.fetchedAt, cutoff)).returning({ id: suggestionBodies.messageId })).length;
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
