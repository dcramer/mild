import { listLabels } from '../store/labels.ts';
import { finishAsk, startAsk } from '../store/mail-calls.ts';
import type { Sql } from '../store/sql.ts';
import type { MailAnswer, MailAsker } from '../prompts/mail-ask.ts';
import { recordedAsk } from './recorded.ts';
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
  return await recordedAsk<MailAnswer>({
    agent: 'ask',
    conversation: [db.person, id],
    attributes: { 'sift.ask': id },
    ask: () => deps.ask({ words: request.words, today: request.today, labels }, find),
    finish: (outcome, spent) => finishAsk(db, request.accountId, id, { ...('error' in outcome ? outcome : { answer: outcome }), ...spent }),
    report: 'Asking failed',
    refusal: (failed) => `The model could not make a filter (${failed}). Try again, or use Filters.`,
    now,
  });
}
