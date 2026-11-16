import { and, asc, decisions, desc, eq, messages, notExists } from './query.ts';
import type { Sql } from './sql.ts';
import { type Facts, deriveFacts } from '../triage/facts.ts';
import type { Address, MessageFacts } from '../triage/types.ts';

const COLUMNS = {
  id: messages.id,
  threadId: messages.threadId,
  fromAddress: messages.fromAddress,
  fromDomain: messages.fromDomain,
  fromName: messages.fromName,
  receivedAt: messages.receivedAt,
  subject: messages.subject,
  toJson: messages.toJson,
  ccJson: messages.ccJson,
  headersJson: messages.headersJson,
  labelsJson: messages.labelsJson,
  observeOnly: messages.observeOnly,
  factsJson: messages.factsJson,
};

interface Row {
  id: string;
  threadId: string;
  fromAddress: string;
  fromDomain: string;
  fromName: string | null;
  receivedAt: number;
  subject: string;
  toJson: string;
  ccJson: string;
  headersJson: string;
  labelsJson: string;
  observeOnly: number;
  factsJson: string | null;
}

const toMessage = (accountId: string, r: Row): MessageFacts => ({
  accountId,
  messageId: r.id,
  threadId: r.threadId,
  from: { address: r.fromAddress, domain: r.fromDomain, ...(r.fromName ? { name: r.fromName } : {}) },
  to: JSON.parse(r.toJson) as Address[],
  cc: JSON.parse(r.ccJson) as Address[],
  subject: r.subject,
  labelIds: JSON.parse(r.labelsJson) as string[],
  headers: JSON.parse(r.headersJson) as Record<string, string>,
  receivedAt: r.receivedAt,
});

export interface QueuedMessage {
  facts: MessageFacts;
  /** Pulled in from before sift was connected: suggest, never act. */
  observeOnly: boolean;
}

/**
 * Recorded messages that have no decision yet, newest first, rebuilt as triage input. This is the triage queue.
 * Newest first because mail can wait in it (with no model, what no rule covers is left there), and what waits
 * must never keep new mail from being sorted.
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
      ),
    )
    .orderBy(desc(messages.receivedAt), asc(messages.id))
    .limit(limit);
  return rows.map((r) => ({ observeOnly: r.observeOnly === 1, facts: toMessage(accountId, r) }));
}

/** The facts recorded for a message, or null if sift has not seen it. Rows synced before facts were recorded get them from their stored headers. */
export async function storedFacts(db: Sql, accountId: string, messageId: string): Promise<Facts | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  if (!row) return null;
  return row.factsJson ? (JSON.parse(row.factsJson) as Facts) : deriveFacts(toMessage(accountId, row));
}

/** Replace a message's recorded facts, once reading the whole message has added to them. */
export async function recordFacts(db: Sql, accountId: string, messageId: string, facts: Facts): Promise<void> {
  await db
    .update(messages)
    .set({ factsJson: JSON.stringify(facts) })
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
