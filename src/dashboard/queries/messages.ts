import { actions, and, asc, decisions, eq, examples, messages, modelRuns, sql, suggestionBodies } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { unsubscribedAt } from '../../store/actions.ts';
import { storedFacts } from '../../store/messages.ts';
import { bulkSignals, passedDmarc } from '../../triage/features.ts';
import { type Scope, sees } from '../scope.ts';
import type { MessageDetail } from '../types.ts';
import { decisionsJoined, toDecisionRow } from './decisions.ts';
import { senderProfile } from './senders.ts';

/** One message with its full history, or null if sift has not seen it. */
export async function messageDetail(db: Sql, scope: Scope, accountId: string, messageId: string): Promise<MessageDetail | null> {
  if (!sees(scope, accountId)) return null;
  const [m] = await db
    .select({
      threadId: messages.threadId,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      to: messages.to,
      cc: messages.cc,
      subject: messages.subject,
      listId: messages.listId,
      receivedAt: messages.receivedAt,
      syncedAt: messages.syncedAt,
      headers: messages.headers,
    })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  const facts = await storedFacts(db, accountId, messageId);
  if (!m || !facts) return null;

  const ofMessage = and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId));
  const shown = await decisionsJoined(db).where(ofMessage).orderBy(asc(decisions.id));
  const costs = new Map(
    (
      await db
        .select({
          id: decisions.id,
          ruleId: decisions.ruleId,
          inputTokens: sql<number>`coalesce(${modelRuns.inputTokens}, 0)`.mapWith(Number),
          outputTokens: sql<number>`coalesce(${modelRuns.outputTokens}, 0)`.mapWith(Number),
          durationMs: decisions.durationMs,
        })
        .from(decisions)
        .leftJoin(modelRuns, eq(modelRuns.id, decisions.runId))
        .where(ofMessage)
    ).map(({ id, ...rest }) => [id, rest] as const),
  );
  const changes = await db
    .select({
      id: actions.id,
      type: actions.type,
      status: actions.status,
      decisionId: actions.decisionId,
      payload: actions.payload,
      originalLabels: actions.originalLabels,
      finalLabels: actions.finalLabels,
      error: actions.error,
      createdAt: actions.createdAt,
    })
    .from(actions)
    .where(and(eq(actions.accountId, accountId), eq(actions.messageId, messageId)))
    .orderBy(asc(actions.id));

  return {
    accountId,
    messageId,
    threadId: m.threadId,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    listId: m.listId,
    receivedAt: m.receivedAt,
    syncedAt: m.syncedAt,
    headers: m.headers,
    body: await storedBody(db, accountId, messageId),
    facts,
    unsubscribe: await canUnsubscribe(db, accountId, m.fromAddress, m.headers),
    sender: (await senderProfile(db, scope, accountId, m.fromAddress))!,
    decisions: shown.map((r) => ({ ...toDecisionRow(r), ...costs.get(r.id)! })),
    actions: changes.map(({ payload, originalLabels, ...a }) => ({
      ...a,
      added: payload.add,
      removed: payload.remove,
      originalLabels: originalLabels ?? [],
    })),
  };
}

/** The text of a message, if sift is holding it: as a suggestion's temporary copy, or in an example the user made. */
async function storedBody(db: Sql, accountId: string, messageId: string): Promise<string | null> {
  const [held] = await db
    .select({ body: suggestionBodies.bodyText })
    .from(suggestionBodies)
    .where(and(eq(suggestionBodies.accountId, accountId), eq(suggestionBodies.messageId, messageId)));
  if (held) return held.body;
  const [kept] = await db
    .select({ body: examples.bodyText })
    .from(examples)
    .where(and(eq(examples.accountId, accountId), eq(examples.messageId, messageId), eq(examples.status, 'captured')));
  return kept?.body ?? null;
}

/** Whether sift can leave the list a message came from. Mirrors what `unsubscribe` in src/actions will agree to. */
async function canUnsubscribe(db: Sql, accountId: string, sender: string, headers: Record<string, string>): Promise<MessageDetail['unsubscribe']> {
  const signals = bulkSignals(headers);
  if (!signals.hasListUnsubscribe) return 'none';
  if ((await unsubscribedAt(db, accountId, sender)) !== null) return 'done';
  return signals.oneClickUnsubscribeUrl && passedDmarc(headers) ? 'available' : 'manual';
}
