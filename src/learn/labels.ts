import { Refusal } from '../refusal.ts';
import { finishLabelProposal, listLabels, startLabelProposal } from '../store/labels.ts';
import type { Sql } from '../store/sql.ts';
import { invokeAgent, reportError } from '../telemetry.ts';
import type { LabelDraft, Proposer } from '../triage/proposal.ts';
import { LEAVE_IN_INBOX } from '../triage/types.ts';

/**
 * Ask the model for labels that serve what the person said they want, recorded before the call and with
 * what it cost. Nothing is made: the person accepts what they want of it. Rejects when the call failed.
 */
export async function proposeLabels(
  deps: { db: Sql; propose: Proposer; model: string; now?: () => number },
  request: { accountId: string; goal: string },
): Promise<{ id: number; goal: string; drafts: LabelDraft[]; note?: string; at: number }> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const at = now();
  const id = await startLabelProposal(db, { ...request, model: deps.model, now: at });
  const labels = (await listLabels(db, request.accountId)).filter((l) => l.id !== LEAVE_IN_INBOX);
  const answer = await invokeAgent('labels', [db.person, id], { 'sift.label_proposal': id }, () => deps.propose({ goal: request.goal, labels }));
  const usage = answer.usage ? { usage: answer.usage } : {};
  if ('failed' in answer) {
    await finishLabelProposal(db, request.accountId, id, { error: answer.failed, ...usage, now: now() });
    // A refusal is the page's to show and is not reported, but a model that keeps failing is Sift's to fix.
    reportError(new Error(`Label suggestion failed: ${answer.failed}`));
    throw new Refusal(`The model could not suggest labels (${answer.failed}). Try again.`);
  }
  const note = answer.note ? { note: answer.note } : {};
  await finishLabelProposal(db, request.accountId, id, { drafts: answer.drafts, ...note, ...usage, now: now() });
  return { id, goal: request.goal, drafts: answer.drafts, ...note, at };
}
