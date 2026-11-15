import type { Decision } from '../triage/types.ts';
import type { MessageAction } from './executor.ts';

/** Marks mail left for the user: no tier could place it, or its label says to ask. It stays in the inbox. */
export const REVIEW_LABEL = 'sift/review';

/**
 * Turn a triage decision into the mailbox action that carries it out. The message gets its label's
 * Gmail label whatever happens to it; the executor adds the label for what sift did. Null means leave
 * the message untouched.
 */
export function planAction(decision: Pick<Decision, 'disposition' | 'gmailLabel'>): MessageAction | null {
  const labels = decision.gmailLabel ? [decision.gmailLabel] : [];
  switch (decision.disposition) {
    case 'keep':
      return labels.length > 0 ? { type: 'label', labels } : null;
    case 'archive':
      return { type: 'archive', labels };
    case 'spam':
      return { type: 'spam', labels };
    case 'review':
      return { type: 'label', labels: [...labels, REVIEW_LABEL] };
  }
}
