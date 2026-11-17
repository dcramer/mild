import { Refusal } from '../refusal.ts';
import { listLabels } from '../store/labels.ts';
import { finishRuleDraft, startRuleDraft } from '../store/rules.ts';
import { senderDirectory } from '../store/senders.ts';
import type { Sql } from '../store/sql.ts';
import { invokeAgent, reportError } from '../telemetry.ts';
import { type FoundSender, type RuleDraft, type RuleDrafter, searchSenders } from '../triage/rule-draft.ts';

/**
 * Ask the model to fill in a rule from what the person said, looking up their senders as it needs, recorded
 * before the call and with what it cost. Nothing is made: the dialog shows the rule for them to add.
 * Rejects when the call failed.
 */
export async function draftRule(
  deps: { db: Sql; draft: RuleDrafter; model: string; now?: () => number },
  request: { accountId: string; goal: string },
): Promise<RuleDraft> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const id = await startRuleDraft(db, { ...request, model: deps.model, now: now() });
  const labels = await listLabels(db, request.accountId);
  // Read once, on the first look-up: most of what is asked for names no sender.
  let senders: Promise<FoundSender[]> | undefined;
  const find = async (query: string) => searchSenders(await (senders ??= senderDirectory(db, request.accountId)), query);
  const answer = await invokeAgent('rules', [db.person, id], { 'sift.rule_draft': id }, async () => {
    try {
      return await deps.draft({ goal: request.goal, labels }, find);
    } catch (error) {
      // A look-up that threw: the call still ends on the record, as one that failed.
      await finishRuleDraft(db, request.accountId, id, { error: error instanceof Error ? error.message : String(error), lookups: 0, now: now() });
      throw error;
    }
  });
  const spent = { lookups: answer.lookups, ...(answer.usage ? { usage: answer.usage } : {}), now: now() };
  if ('failed' in answer) {
    await finishRuleDraft(db, request.accountId, id, { error: answer.failed, ...spent });
    // A refusal is the page's to show and is not reported, but a model that keeps failing is Sift's to fix.
    reportError(new Error(`Rule drafting failed: ${answer.failed}`));
    throw new Refusal(`The model could not fill in a rule (${answer.failed}). Try again, or fill it in yourself.`);
  }
  await finishRuleDraft(db, request.accountId, id, { draft: answer.draft, ...spent });
  return answer.draft;
}
