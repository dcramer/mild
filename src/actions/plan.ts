import type { Decision } from '../triage/types.ts';
import type { MessageAction } from './executor.ts';

/**
 * Turn a triage decision into the mailbox action that carries it out. The message gets its label's
 * Gmail label whatever happens to it, and no label of Mild's own. Null means leave the message untouched.
 */
export function planAction(decision: Pick<Decision, 'disposition' | 'gmailLabel' | 'markRead'>): MessageAction | null {
  const labels = decision.gmailLabel ? [decision.gmailLabel] : [];
  const read = decision.markRead ? { markRead: true } : {};
  switch (decision.disposition) {
    case 'keep':
      return labels.length > 0 || decision.markRead ? { type: 'label', labels, ...read } : null;
    case 'review':
      return labels.length > 0 ? { type: 'label', labels } : null;
    case 'archive':
      return { type: 'archive', labels, ...read };
    case 'spam':
      return { type: 'spam', labels };
  }
}
