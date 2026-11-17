import { Refusal } from '../refusal.ts';
import { finishLabelProposal, listLabels, startLabelProposal } from '../store/labels.ts';
import type { Sql } from '../store/sql.ts';
import { reportError, traced } from '../telemetry.ts';
import type { LabelDraft, Proposer } from '../triage/proposal.ts';
import { EVERYTHING_ELSE } from '../triage/types.ts';

/**
 * Ask the model for labels that serve what the person said they want, recorded before the call and with
 * what it cost. Nothing is made: the person accepts what they want of it. Rejects when the call failed.
 */
export async function proposeLabels(
  deps: { db: Sql; propose: Proposer; model: string; now?: () => number },
  request: { accountId: string; goal: string },
): Promise<{ id: number; goal: string; drafts: LabelDraft[]; at: number }> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const at = now();
  const id = await startLabelProposal(db, { ...request, model: deps.model, now: at });
  const labels = (await listLabels(db, request.accountId)).filter((l) => l.id !== EVERYTHING_ELSE);
  const answer = await traced(
    'gen_ai.invoke_agent',
    'invoke_agent labels',
    { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'labels', 'sift.label_proposal': id },
    async (span) => {
      const settled = await deps.propose({ goal: request.goal, labels });
      if ('failed' in settled) span.fail();
      return settled;
    },
  );
  const usage = answer.usage ? { usage: answer.usage } : {};
  if ('failed' in answer) {
    await finishLabelProposal(db, request.accountId, id, { error: answer.failed, ...usage, now: now() });
    // A refusal is the page's to show and is not reported, but a model that keeps failing is Sift's to fix.
    reportError(new Error(`Label suggestion failed: ${answer.failed}`));
    throw new Refusal(`The model could not suggest labels (${answer.failed}). Try again.`);
  }
  await finishLabelProposal(db, request.accountId, id, { drafts: answer.drafts, ...usage, now: now() });
  return { id, goal: request.goal, drafts: answer.drafts, at };
}
