import { seal } from '../plain.ts';
import { Refusal } from '../refusal.ts';
import { listLabels } from '../store/labels.ts';
import { type RecordedSummary, conversationText, finishAsk, finishSummary, startAsk, startSummary, summariesOf } from '../store/mail-calls.ts';
import type { Sql } from '../store/sql.ts';
import { invokeAgent, reportError } from '../telemetry.ts';
import type { MailAnswer, MailAsker } from '../triage/mail-ask.ts';
import type { Summarizer } from '../triage/mail-summary.ts';
import { senderLookup } from './rules.ts';

/**
 * Ask the model to turn the person's words into a filter on Inbox's list, looking up their senders as it needs,
 * recorded before the call and with what it cost, under `accountId`. Nothing is narrowed here: the page shows the filter.
 * Rejects when the call failed.
 */
export async function askMail(
  deps: { db: Sql; ask: MailAsker; model: string; now?: () => number },
  request: { accountId: string; words: string; today: string },
): Promise<MailAnswer> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const id = await startAsk(db, { accountId: request.accountId, words: request.words, model: deps.model, now: now() });
  const labels = await listLabels(db);
  const find = senderLookup(db);
  const answer = await invokeAgent('ask', [db.person, id], { 'sift.ask': id }, async () => {
    try {
      return await deps.ask({ words: request.words, today: request.today, labels }, find);
    } catch (error) {
      await finishAsk(db, request.accountId, id, { error: error instanceof Error ? error.message : String(error), lookups: 0, now: now() });
      throw error;
    }
  });
  const { usage, lookups, ...said } = answer;
  const spent = { lookups, ...(usage ? { usage } : {}), now: now() };
  if ('failed' in said) {
    await finishAsk(db, request.accountId, id, { error: said.failed, ...spent });
    reportError(new Error(`Asking failed: ${said.failed}`));
    throw new Refusal(`The model could not make a filter (${said.failed}). Try again, or use Filters.`);
  }
  await finishAsk(db, request.accountId, id, { answer: said, ...spent });
  return said;
}

/**
 * What the conversation says, from the text Sift holds of it: the one recorded for it as it is now, or the model's,
 * asked now and recorded before the call with what it cost. Rejects when Sift holds none of its text or the call failed.
 */
export async function summarizeThread(
  deps: { db: Sql; summarize: Summarizer; model: string; now?: () => number },
  request: { accountId: string; threadId: string },
): Promise<RecordedSummary> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const conversation = await conversationText(db, request.accountId, request.threadId);
  if (!conversation || conversation.messages.every((m) => m.text.trim() === '')) throw new Refusal('Sift holds none of this conversation’s text yet.');
  const recorded = (await summariesOf(db, request.accountId, request.threadId)).findLast((s) => s.newestId === conversation.newestId && s.summary !== null);
  if (recorded) return recorded;

  const startedAt = now();
  const id = await startSummary(db, { ...request, newestId: conversation.newestId, model: deps.model, now: startedAt });
  const answer = await invokeAgent('summary', [db.person, id], { 'sift.summary': id }, async () => {
    try {
      return await deps.summarize(conversation);
    } catch (error) {
      await finishSummary(db, request, id, { error: error instanceof Error ? error.message : String(error), now: now() });
      throw error;
    }
  });
  const finishedAt = now();
  if ('failed' in answer) {
    await finishSummary(db, request, id, { error: answer.failed, ...(answer.usage ? { usage: answer.usage } : {}), now: finishedAt });
    reportError(new Error(`Summarizing failed: ${answer.failed}`));
    throw new Refusal(`The model could not summarize this (${answer.failed}). Try again.`);
  }
  await finishSummary(db, request, id, { summary: answer.summary, ...(answer.usage ? { usage: answer.usage } : {}), now: finishedAt });
  return {
    newestId: conversation.newestId,
    at: finishedAt,
    model: deps.model,
    inputTokens: answer.usage?.inputTokens ?? 0,
    outputTokens: answer.usage?.outputTokens ?? 0,
    costUsd: answer.usage?.costUsd ?? 0,
    summary: seal(answer.summary),
    failed: false,
  };
}
