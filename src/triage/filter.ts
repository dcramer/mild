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
const does = (
  rule: Rule,
  label: Label | undefined,
): { disposition: string | undefined; labelId?: string | undefined; markRead?: boolean | undefined; digest?: boolean | undefined } =>
  label ? labelled(label, rule.disposition) : { disposition: rule.disposition };

/** Whether one sender value (an address, or a domain) could be the same mail's sender as another. */
const sameSender = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  if (x.includes('@') === y.includes('@')) return x === y;
  return x.includes('@') ? x.endsWith(`@${y}`) : y.endsWith(`@${x}`);
};

/** False only when no message could match both. Errs towards true. */
function mayOverlap(a: RuleMatch, b: RuleMatch): boolean {
  const senders = (m: RuleMatch) => [...(m.from ?? []), ...(m.fromDomain ?? [])];
  const meet = (x: readonly string[], y: readonly string[], same: (v: string, w: string) => boolean) =>
    x.length === 0 || y.length === 0 || x.some((v) => y.some((w) => same(v, w)));
  const equal = (v: string, w: string) => v.toLowerCase() === w.toLowerCase();
  return meet(senders(a), senders(b), sameSender) && meet(a.listId ?? [], b.listId ?? [], equal);
}

/** Values for one Gmail search field: one as it is, several as alternatives. */
const anyOf = (values: readonly string[]) => values.join(' OR ');

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
  if (!label?.gmailLabel && outcome.disposition === 'keep') return no('It only keeps mail in your inbox, which Gmail does anyway.');
  if (outcome.disposition === 'spam') return no('Gmail filters cannot mark mail as spam.');
  if (outcome.disposition !== 'keep' && outcome.disposition !== 'archive') return no('Its label leaves mail for you.');
  const archive = outcome.disposition === 'archive';
  if (rule.markRead || outcome.markRead) return no('It marks mail read, which Sift does not let a filter do.');
  if (outcome.digest) return no('Its label puts mail in a daily digest, and mail a filter archives never reaches Sift to be listed there.');
  if (rule.learned && archive) return no('Sift learned this rule and holds it back for people you have written to. A filter cannot.');

  const { from, fromDomain, fromName, fromNameContains, to, listId, subjectContains } = rule.match;
  if (listId !== undefined && listId.length > 0) return no('Gmail filters cannot match a mailing list.');
  if ((fromName ?? []).length > 0 || (fromNameContains ?? []).length > 0)
    return no('Gmail filters match words in a sender’s name and address together, so they cannot hold to the name.');
  if (asksFacts(rule.match)) return no('It asks what Sift found in the message, which Gmail filters cannot see.');
  if ((rule.except ?? []).length > 0) return no('It has exceptions.');

  const criteria: FilterPlan['criteria'] = {};
  const differs: string[] = [];
  const unsafe = no('Its conditions cannot be written as a Gmail search safely.');
  const addresses = (from ?? []).map((a) => a.toLowerCase());
  const domains = (fromDomain ?? []).map((d) => d.toLowerCase());
  if (!addresses.every((a) => ADDRESS.test(a)) || !domains.every((d) => DOMAIN.test(d))) return unsafe;
  if (addresses.length + domains.length > 0) criteria.from = anyOf([...addresses, ...domains.map((d) => `@${d}`)]);
  if (to !== undefined && to.length > 0) {
    const all = to.map((a) => a.toLowerCase());
    if (!all.every((a) => ADDRESS.test(a))) return unsafe;
    criteria.to = anyOf(all);
    differs.push('Gmail also matches mail that only copies this address (Cc or Bcc).');
  }
  if (subjectContains !== undefined && subjectContains.length > 0) {
    if (subjectContains.some((words) => words.includes('"') || words.trim() === '')) return unsafe;
    criteria.subject = anyOf(subjectContains.map((words) => `"${words.trim()}"`));
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
