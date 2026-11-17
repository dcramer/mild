import { type Rule, type RuleMatch, asksFacts, describeMatch, specificity } from './stages/rules.ts';
import { type Label, labelled } from './types.ts';

/** A rule as Gmail could run it by itself. The label is named, not given by id: the id is Gmail's to assign. */
export interface FilterPlan {
  criteria: { from?: string; to?: string; subject?: string };
  /** Absent for a rule that only says what happens to the mail. */
  gmailLabel?: string;
  /** Also take the mail out of the inbox. */
  archive: boolean;
}

export type FilterVerdict =
  | {
      possible: true;
      plan: FilterPlan;
      /** Where Gmail will not do exactly what the rule does. */
      differs: string[];
    }
  | { possible: false; reason: string };

export type FilterableRule = Rule;

// The values go into a Gmail search, so anything that could change the search's meaning is refused.
const ADDRESS = /^[^\s"'(){}<>:,]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const no = (reason: string): FilterVerdict => ({ possible: false, reason });

/** What a rule does to mail, with or without a label of its own. */
const does = (rule: Rule, label: Label | undefined): { disposition: string | undefined; labelId?: string | undefined; markRead?: boolean | undefined } =>
  label ? labelled(label, rule.disposition) : { disposition: rule.disposition };

/** False only when no message could match both. Errs towards true. */
function mayOverlap(a: RuleMatch, b: RuleMatch): boolean {
  const differ = (x: string | undefined, y: string | undefined) => x !== undefined && y !== undefined && x.toLowerCase() !== y.toLowerCase();
  const domainOf = (m: RuleMatch) => m.fromDomain ?? m.from?.split('@')[1];
  return !differ(a.from, b.from) && !differ(domainOf(a), domainOf(b)) && !differ(a.listId, b.listId);
}

/**
 * Whether a rule can be copied to Gmail as a filter, and what the filter is. A filter runs on every
 * message before sift sees it and knows nothing of sift's other rules or protections, so a rule
 * qualifies only when the filter could never do something sift itself would not have done.
 * `rules` is every rule of the account, for finding one that could decide the same mail differently.
 */
export function filterFor(rule: FilterableRule, labels: readonly Label[], rules: readonly FilterableRule[]): FilterVerdict {
  if (rule.whenLabel !== undefined) return no('It applies only once Sift has said what the mail is.');
  const label = rule.labelId === undefined ? undefined : labels.find((l) => l.id === rule.labelId);
  if (rule.labelId !== undefined && !label) return no('Its label has been removed.');
  if (rule.when !== undefined) return no('It has a condition in plain language, which Gmail cannot match.');

  const outcome = does(rule, label);
  if (!label && outcome.disposition === 'keep') return no('It only keeps mail in your inbox, which Gmail does anyway.');
  if (outcome.disposition === 'spam') return no('Gmail filters cannot mark mail as spam.');
  if (outcome.disposition !== 'keep' && outcome.disposition !== 'archive') return no('Its label leaves mail for you.');
  const archive = outcome.disposition === 'archive';
  if (rule.markRead || outcome.markRead) return no('It marks mail read, which Sift does not let a filter do.');
  if (rule.learned && archive) return no('Sift learned this rule and holds it back for people you have written to. A filter cannot.');

  const { from, fromDomain, fromName, fromNameContains, to, listId, subjectContains } = rule.match;
  if (listId !== undefined) return no('Gmail filters cannot match a mailing list.');
  if (fromName !== undefined || fromNameContains !== undefined)
    return no('Gmail filters match words in a sender’s name and address together, so they cannot hold to the name.');
  if (asksFacts(rule.match)) return no('It asks what Sift found in the message, which Gmail filters cannot see.');
  if ((rule.except ?? []).length > 0) return no('It has exceptions.');

  const criteria: FilterPlan['criteria'] = {};
  const differs: string[] = [];
  const unsafe = no('Its conditions cannot be written as a Gmail search safely.');
  if (from !== undefined) {
    if (!ADDRESS.test(from.toLowerCase()) || (fromDomain !== undefined && from.toLowerCase().split('@')[1] !== fromDomain.toLowerCase())) return unsafe;
    criteria.from = from.toLowerCase();
  } else if (fromDomain !== undefined) {
    if (!DOMAIN.test(fromDomain.toLowerCase())) return unsafe;
    criteria.from = `@${fromDomain.toLowerCase()}`;
  }
  if (to !== undefined) {
    if (!ADDRESS.test(to.toLowerCase())) return unsafe;
    criteria.to = to.toLowerCase();
    differs.push('Gmail also matches mail that only copies this address (Cc or Bcc).');
  }
  if (subjectContains !== undefined) {
    if (subjectContains.includes('"') || subjectContains.trim() === '') return unsafe;
    criteria.subject = `"${subjectContains.trim()}"`;
    differs.push('Gmail matches whole words in the subject, so it can miss mail the rule catches. Sift still handles that mail.');
  }
  if (Object.keys(criteria).length === 0) return no('It has no condition Gmail can match.');

  // In sift a keep rule beats everything and otherwise the narrowest rule wins. Gmail would run this one regardless.
  const rival = rules.find((other) => {
    if (other.id === rule.id || !mayOverlap(rule.match, other.match)) return false;
    const named = other.labelId ?? other.whenLabel;
    const otherLabel = named === undefined ? undefined : labels.find((l) => l.id === named);
    if (named !== undefined && !otherLabel) return false;
    const theirs = does(other, otherLabel);
    const judged = other.whenLabel !== undefined || other.when !== undefined;
    if (!judged && theirs.labelId === outcome.labelId && theirs.disposition === outcome.disposition) return false;
    const narrower = specificity(other.match) >= specificity(rule.match);
    return archive ? theirs.disposition === 'keep' || judged || narrower : (theirs.disposition === 'keep' || judged) && narrower;
  });
  if (rival) return no(`Another rule (${describeMatch(rival.match)}) can decide the same mail, and a filter would get to it first.`);

  if (archive) differs.push('Mail the filter archives never reaches Sift: it is not recorded, counted or unsubscribed from.');
  return { possible: true, plan: { criteria, ...(label ? { gmailLabel: label.gmailLabel } : {}), archive }, differs };
}
