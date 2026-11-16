import type { Sql } from './sql.ts';
import { type Facts, deriveFacts } from '../triage/facts.ts';
import type { Address, MessageFacts } from '../triage/types.ts';

interface Row {
  id: string;
  thread_id: string;
  from_address: string;
  from_domain: string;
  from_name: string | null;
  received_at: number;
  subject: string;
  to_json: string;
  cc_json: string;
  headers_json: string;
  labels_json: string;
  observe_only: number;
  facts_json: string | null;
}

const COLUMNS =
  'id, thread_id, from_address, from_domain, from_name, received_at, subject, to_json, cc_json, headers_json, labels_json, observe_only, facts_json';

const toMessage = (accountId: string, r: Row): MessageFacts => ({
  accountId,
  messageId: r.id,
  threadId: r.thread_id,
  from: { address: r.from_address, domain: r.from_domain, ...(r.from_name ? { name: r.from_name } : {}) },
  to: JSON.parse(r.to_json) as Address[],
  cc: JSON.parse(r.cc_json) as Address[],
  subject: r.subject,
  labelIds: JSON.parse(r.labels_json) as string[],
  headers: JSON.parse(r.headers_json) as Record<string, string>,
  receivedAt: r.received_at,
});

export interface QueuedMessage {
  facts: MessageFacts;
  /** Pulled in from before sift was connected: suggest, never act. */
  observeOnly: boolean;
}

/** Recorded messages that have no decision yet, oldest first, rebuilt as triage input. This is the triage queue. */
export async function listUndecided(db: Sql, accountId: string, limit: number): Promise<QueuedMessage[]> {
  const rows = await db.all<Row>(
    `SELECT ${COLUMNS}
       FROM messages m
       WHERE account_id = ? AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.account_id = m.account_id AND d.message_id = m.id)
       ORDER BY received_at, id LIMIT ?`,
    accountId,
    limit,
  );
  return rows.map((r) => ({ observeOnly: r.observe_only === 1, facts: toMessage(accountId, r) }));
}

/** The facts recorded for a message, or null if sift has not seen it. Rows synced before facts were recorded get them from their stored headers. */
export async function storedFacts(db: Sql, accountId: string, messageId: string): Promise<Facts | null> {
  const row = await db.get<Row>(`SELECT ${COLUMNS} FROM messages WHERE account_id = ? AND id = ?`, accountId, messageId);
  if (!row) return null;
  return row.facts_json ? (JSON.parse(row.facts_json) as Facts) : deriveFacts(toMessage(accountId, row));
}

/** Replace a message's recorded facts, once reading the whole message has added to them. */
export async function recordFacts(db: Sql, accountId: string, messageId: string, facts: Facts): Promise<void> {
  await db.run('UPDATE messages SET facts_json = ? WHERE account_id = ? AND id = ?', JSON.stringify(facts), accountId, messageId);
}

/** One recorded message as triage input, or null if sift never saw it. */
export async function getFacts(db: Sql, accountId: string, messageId: string): Promise<MessageFacts | null> {
  const row = await db.get<Row>(`SELECT ${COLUMNS} FROM messages WHERE account_id = ? AND id = ?`, accountId, messageId);
  return row ? toMessage(accountId, row) : null;
}
