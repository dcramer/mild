import { finishLabelProposal, listLabels, startLabelProposal } from '../store/labels.ts';
import type { Sql } from '../store/sql.ts';
import type { LabelDraft, Proposer } from '../triage/proposal.ts';
import { LEAVE_IN_INBOX } from '../triage/types.ts';
import { recordedAsk } from './recorded.ts';

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
  const labels = (await listLabels(db)).filter((l) => l.id !== LEAVE_IN_INBOX);
  const answer = await recordedAsk<{ drafts: LabelDraft[]; note?: string }>({
    agent: 'labels',
    conversation: [db.person, id],
    attributes: { 'sift.label_proposal': id },
    ask: () => deps.propose({ goal: request.goal, labels }),
    finish: (outcome, spent) => finishLabelProposal(db, request.accountId, id, { ...outcome, ...spent }),
    report: 'Label suggestion failed',
    refusal: (failed) => `The model could not suggest labels (${failed}). Try again.`,
    now,
  });
  const note = answer.note ? { note: answer.note } : {};
  return { id, goal: request.goal, drafts: answer.drafts, ...note, at };
}
