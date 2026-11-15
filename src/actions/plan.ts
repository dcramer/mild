import type { Decision } from '../triage/types.ts';
import type { MessageAction } from './executor.ts';

/** Marks mail left for the user because no tier could place it, or a protection held sift back. It stays in the inbox. */
export const REVIEW_LABEL = 'sift/review';

/**
 * Turn a triage decision into the mailbox action that carries it out. The message gets its label's
 * Gmail label whatever happens to it; the executor adds the label for what sift did. Null means leave
 * the message untouched.
 */
export function planAction(decision: Pick<Decision, 'disposition' | 'gmailLabel' | 'markRead'>): MessageAction | null {
  const labels = decision.gmailLabel ? [decision.gmailLabel] : [];
  const read = decision.markRead ? { markRead: true } : {};
  switch (decision.disposition) {
    case 'keep':
      return labels.length > 0 || decision.markRead ? { type: 'label', labels, ...read } : null;
    case 'archive':
      return { type: 'archive', labels, ...read };
    case 'spam':
      return { type: 'spam', labels };
    case 'review':
      return { type: 'label', labels: [...labels, REVIEW_LABEL] };
  }
}
