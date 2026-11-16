import type { RuleFacts } from '../triage/facts.ts';

/** A Gmail filter as proposed by a rule promotion or the agent. Mirrors `users.settings.filters`. */
export interface FilterProposal {
  criteria: {
    from?: string;
    to?: string;
    subject?: string;
    query?: string;
    negatedQuery?: string;
  };
  action: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
    /** Present only so validation can reject it. sift never forwards mail. */
    forward?: string;
  };
  /**
   * The conditions on what sift found in the message, of the rule the filter is made for. Present only so
   * validation can reject them: a filter without them would match more mail than the rule does.
   */
  facts?: RuleFacts;
}

/** A filter as it stands in Gmail, with every criterion and action Gmail reports, not only the ones sift writes. */
export interface ExistingFilter {
  id: string;
  criteria: Record<string, string | number | boolean>;
  action: { addLabelIds: string[]; removeLabelIds: string[]; forward?: string };
}

const canonical = (filter: Pick<ExistingFilter | FilterProposal, 'criteria' | 'action'>) =>
  JSON.stringify([
    Object.entries(filter.criteria)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, typeof value === 'string' ? value.toLowerCase() : value])
      .toSorted(([a], [b]) => String(a).localeCompare(String(b))),
    (filter.action.addLabelIds ?? []).toSorted(),
    (filter.action.removeLabelIds ?? []).toSorted(),
    filter.action.forward ?? null,
  ]);

/** Whether two filters match the same mail and do the same to it. */
export const sameFilter = (a: Pick<ExistingFilter | FilterProposal, 'criteria' | 'action'>, b: Pick<ExistingFilter | FilterProposal, 'criteria' | 'action'>) =>
  canonical(a) === canonical(b);

const SYSTEM_LABELS = new Set(['INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'CHAT']);
const isSystemLabel = (id: string) => SYSTEM_LABELS.has(id) || id.startsWith('CATEGORY_');

/** Filters run unattended on all future mail, so only skipping the inbox is allowed. */
const REMOVABLE = new Set(['INBOX']);

/**
 * Deterministic gate for every filter before it reaches Gmail, whoever proposed it.
 * Returns the list of problems; empty means the filter is acceptable.
 */
export function validateFilter(filter: FilterProposal): string[] {
  const problems: string[] = [];
  const { criteria, action } = filter;

  if (action.forward !== undefined) problems.push('forwarding filters are never allowed');
  if (filter.facts && Object.values(filter.facts).some((v) => v !== undefined)) problems.push('Gmail cannot match what sift found in a message');

  const positive = [criteria.from, criteria.to, criteria.subject, criteria.query].filter((v) => v !== undefined && v.trim() !== '');
  if (positive.length === 0) problems.push('criteria must include at least one of from, to, subject or query');

  const add = action.addLabelIds ?? [];
  const remove = action.removeLabelIds ?? [];
  if (add.length === 0 && remove.length === 0) problems.push('filter has no action');

  for (const id of add) if (isSystemLabel(id)) problems.push(`filters may not add system label ${id}`);
  if (add.length > 1) problems.push('Gmail allows only one user label per filter');
  for (const id of remove) if (!REMOVABLE.has(id)) problems.push(`filters may not remove label ${id}`);

  return problems;
}
