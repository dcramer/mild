import type { RuleMatch, RuleSummary } from './api.ts';
import { type FactAnswer, factAnswers } from './format.ts';

/** The one named condition the rule dialog holds. `from` takes an address or a domain. */
export type By = 'from' | 'listId' | 'to' | 'subjectContains';

/**
 * What the rule dialog starts on, from wherever it was opened: everything that place knows about the
 * mail. The user sees all of it, and changes it, before the rule is added.
 */
export interface RuleStart {
  by: By;
  value: string;
  facts: FactAnswer[];
  label?: string;
  /** The label the rule waits for a tier to give, in place of `label`. */
  whenLabel?: string;
  /** With no label, or when it waits for one: what happens to the mail. */
  action?: 'keep' | 'archive' | 'spam';
}

/** What a rule waiting for a label does, for what the label does: a rule cannot block, and a label left for review is kept, as an answer keeps it. */
const WAITING_DOES = { keep: 'keep', archive: 'archive', spam: 'spam', block: 'spam', review: 'keep' } as const;

/**
 * A proposed rule, waiting for its label and then doing what the label does. A proposal names one sender,
 * so its match has one named condition.
 */
export function proposalStart({ facts, ...match }: RuleMatch, label: string, does: string): RuleStart {
  const [key, value] = Object.entries(match)[0] ?? ['from', ''];
  return {
    by: key === 'fromDomain' ? 'from' : (key as By),
    value: value ?? '',
    facts: factAnswers(facts),
    whenLabel: label,
    action: WAITING_DOES[does as keyof typeof WAITING_DOES] ?? 'keep',
  };
}

/** A message's sender, as what sift says the message is. */
export const messageStart = (sender: string, label: string | null): RuleStart => ({
  by: 'from',
  value: sender,
  facts: [],
  ...(label === null ? {} : { label }),
});

/** A message's sender, when their mail is what sift says it is but should stay in the inbox. */
export const keepStart = (sender: string, label: string): RuleStart => ({ by: 'from', value: sender, facts: [], whenLabel: label, action: 'keep' });

/** A message's sender and one thing sift saw in it. */
export const factStart = (sender: string, fact: FactAnswer): RuleStart => ({ by: 'from', value: sender, facts: [fact] });

/** Everything on a mailing list. */
export const listStart = (listId: string): RuleStart => ({ by: 'listId', value: listId, facts: [] });

const STANDING_DOES = { trusted: 'keep', unwanted: 'archive', blocked: 'spam' } as const;

/** A standing is a rule for exactly that sender or domain that says only what happens to their mail. */
export const standingStart = (who: { address: string } | { domain: string }, standing: keyof typeof STANDING_DOES): RuleStart => ({
  by: 'from',
  value: 'address' in who ? who.address : who.domain,
  facts: [],
  action: STANDING_DOES[standing],
});

/** A value with its keys in one order, so two matches written differently compare alike. */
const canonical = (value: unknown): unknown =>
  value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      )
    : value;

/** The rule adding `match` would replace: one of the account's with exactly those conditions, no exceptions, waiting for the same label or none. */
export function replacedBy(rules: readonly RuleSummary[], accountId: string, match: RuleMatch, whenLabel: string | null): RuleSummary | undefined {
  const key = JSON.stringify(canonical(match));
  return rules.find((r) => r.accountId === accountId && r.whenLabel === whenLabel && r.except.length === 0 && JSON.stringify(canonical(r.match)) === key);
}
