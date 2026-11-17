import { Refusal } from '../refusal.ts';
import { listLabels } from '../store/labels.ts';
import { finishRuleDraft, startRuleDraft } from '../store/rules.ts';
import { senderDirectory } from '../store/senders.ts';
import type { Sql } from '../store/sql.ts';
import { reportError, traced } from '../telemetry.ts';
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
  const answer = await traced(
    'gen_ai.invoke_agent',
    'invoke_agent rules',
    { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'rules', 'sift.rule_draft': id },
    async (span) => {
      const settled = await deps.draft({ goal: request.goal, labels }, find);
      if ('failed' in settled) span.fail();
      return settled;
    },
  );
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
