import type { Sql } from '../../store/sql.ts';
import { unsubscribedAt } from '../../store/actions.ts';
import { storedFacts } from '../../store/messages.ts';
import { bulkSignals, passedDmarc } from '../../triage/features.ts';
import { type Scope, sees } from '../scope.ts';
import type { MessageDetail } from '../types.ts';
import { type DecisionSqlRow, DECISION_SELECT, toDecisionRow } from './decisions.ts';
import { senderProfile } from './senders.ts';

/** One message with its full history, or null if sift has not seen it. */
export async function messageDetail(db: Sql, scope: Scope, accountId: string, messageId: string): Promise<MessageDetail | null> {
  if (!sees(scope, accountId)) return null;
  const m = await db.get<{
    thread_id: string;
    from_address: string;
    from_name: string | null;
    to_json: string;
    cc_json: string;
    subject: string;
    list_id: string | null;
    received_at: number;
    synced_at: number | null;
    headers_json: string;
  }>(
    `SELECT thread_id, from_address, from_name, to_json, cc_json, subject, list_id, received_at, synced_at, headers_json
       FROM messages WHERE account_id = ? AND id = ?`,
    accountId,
    messageId,
  );
  const facts = await storedFacts(db, accountId, messageId);
  if (!m || !facts) return null;

  const decisions = await db.all<
    DecisionSqlRow & {
      rule_id: string | null;
      input_tokens: number;
      output_tokens: number;
      duration_ms: number | null;
    }
  >(
    `SELECT x.*, d.rule_id, d.input_tokens, d.output_tokens, d.duration_ms
       FROM (${DECISION_SELECT} WHERE d.account_id = ? AND d.message_id = ?) x JOIN decisions d ON d.id = x.id ORDER BY x.id`,
    accountId,
    messageId,
  );
  const actions = await db.all<{
    id: number;
    type: string;
    status: string;
    decision_id: number | null;
    payload_json: string;
    original_labels: string | null;
    final_labels: string | null;
    error: string | null;
    created_at: number;
  }>(
    `SELECT id, type, status, decision_id, payload_json, original_labels, final_labels, error, created_at
       FROM actions WHERE account_id = ? AND message_id = ? ORDER BY id`,
    accountId,
    messageId,
  );

  return {
    accountId,
    messageId,
    threadId: m.thread_id,
    fromAddress: m.from_address,
    fromName: m.from_name,
    to: JSON.parse(m.to_json) as MessageDetail['to'],
    cc: JSON.parse(m.cc_json) as MessageDetail['cc'],
    subject: m.subject,
    listId: m.list_id,
    receivedAt: m.received_at,
    syncedAt: m.synced_at,
    headers: JSON.parse(m.headers_json) as Record<string, string>,
    body: await storedBody(db, accountId, messageId),
    facts,
    unsubscribe: await canUnsubscribe(db, accountId, m.from_address, JSON.parse(m.headers_json) as Record<string, string>),
    sender: (await senderProfile(db, scope, accountId, m.from_address))!,
    decisions: decisions.map((r) => ({
      ...toDecisionRow(r),
      ruleId: r.rule_id,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      durationMs: r.duration_ms,
    })),
    actions: actions.map((a) => {
      const payload = JSON.parse(a.payload_json) as { add?: string[]; remove?: string[] };
      return {
        id: a.id,
        type: a.type,
        status: a.status,
        decisionId: a.decision_id,
        added: payload.add ?? [],
        removed: payload.remove ?? [],
        originalLabels: a.original_labels ? (JSON.parse(a.original_labels) as string[]) : [],
        finalLabels: a.final_labels ? (JSON.parse(a.final_labels) as string[]) : null,
        error: a.error,
        createdAt: a.created_at,
      };
    }),
  };
}

/** The text of a message, if sift is holding it: as a suggestion's temporary copy, or in an example the user made. */
async function storedBody(db: Sql, accountId: string, messageId: string): Promise<string | null> {
  const row = (await db.get<{ body: string | null }>(
    `SELECT coalesce(
         (SELECT body_text FROM suggestion_bodies WHERE account_id = ?1 AND message_id = ?2),
         (SELECT body_text FROM examples WHERE account_id = ?1 AND message_id = ?2 AND status = 'captured')) AS body`,
    accountId,
    messageId,
  ))!;
  return row.body;
}

/** Whether sift can leave the list a message came from. Mirrors what `unsubscribe` in src/actions will agree to. */
async function canUnsubscribe(db: Sql, accountId: string, sender: string, headers: Record<string, string>): Promise<MessageDetail['unsubscribe']> {
  const signals = bulkSignals(headers);
  if (!signals.hasListUnsubscribe) return 'none';
  if ((await unsubscribedAt(db, accountId, sender)) !== null) return 'done';
  return signals.oneClickUnsubscribeUrl && passedDmarc(headers) ? 'available' : 'manual';
}
