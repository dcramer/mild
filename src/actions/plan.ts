import type { Decision } from '../triage/types.ts';
import type { MessageAction } from './executor.ts';

/** Marks mail no tier could decide. It stays in the inbox. */
export const REVIEW_LABEL = 'sift/review';

/** Turn a triage decision into the mailbox action that carries it out. Null means leave the message untouched. */
export function planAction(decision: Pick<Decision, 'disposition' | 'label'>): MessageAction | null {
  switch (decision.disposition) {
    case 'keep':
      return decision.label ? { type: 'label', label: decision.label } : null;
    case 'archive':
      return decision.label ? { type: 'archive', label: decision.label } : { type: 'archive' };
    case 'spam':
      return { type: 'spam' };
    case 'review':
      return { type: 'label', label: REVIEW_LABEL };
  }
}
