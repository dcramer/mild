import { CONTENT_FACTS, type RuleFacts, deriveFacts, factCondition, matchesFacts } from './facts.ts';
import { parseListId } from './features.ts';
import type { DecidedDisposition, MessageFacts, SubscriptionAction } from './types.ts';

/**
 * Which mail a rule is for. Each condition is a list of values, and mail meets it if any one fits; every
 * condition present must hold. The sender's address and domain are one condition, as are the two ways of
 * asking for their name. A match with no conditions never matches.
 */
export interface RuleMatch {
  /** Exact sender addresses. */
  from?: string[];
  /** Exact sender domains (no subdomain matching). */
  fromDomain?: string[];
  /**
   * The sender's display name, ignoring case and runs of spaces. Anyone can put any name on mail, so a rule
   * holds one only beside `from` or `fromDomain`, whose DMARC says who sent it.
   */
  fromName?: string[];
  /** Case-insensitive substring of the sender's display name. Held only beside `from` or `fromDomain`, as `fromName` is. */
  fromNameContains?: string[];
  /** Exact address in To. Cc does not count. */
  to?: string[];
  listId?: string[];
  /** Case-insensitive substring of the subject. */
  subjectContains?: string[];
  /** What Mild recorded about the message (`Facts`): each one named must have the answer given. */
  facts?: RuleFacts;
}

/** The conditions of a match that name values, as opposed to facts. */
export type Named = Exclude<keyof RuleMatch, 'facts'>;
const NAMED: readonly Named[] = ['from', 'fromDomain', 'fromName', 'fromNameContains', 'to', 'listId', 'subjectContains'];

/** A match with each value trimmed, blanks and repeats (ignoring case) dropped, and conditions left with no value removed. */
export function tidyMatch(match: RuleMatch): RuleMatch {
  const tidy: RuleMatch = {};
  for (const key of NAMED) {
    const seen = new Set<string>();
    const values = (match[key] ?? []).map((v) => v.trim()).filter((v) => v !== '' && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
    if (values.length > 0) tidy[key] = values;
  }
  if (match.facts && Object.values(match.facts).some((v) => v !== undefined)) tidy.facts = match.facts;
  return tidy;
}

const has = (values: readonly string[] | undefined): values is readonly string[] => values !== undefined && values.length > 0;

/** The match's conditions on facts, or null if it has none. */
const factsOf = (match: Pick<RuleMatch, 'facts'>): RuleFacts | null =>
  match.facts && Object.values(match.facts).some((v) => v !== undefined) ? match.facts : null;

/** Whether a match has any condition on facts. */
export const asksFacts = (match: Pick<RuleMatch, 'facts'>) => factsOf(match) !== null;

/** Whether a rule asks about something only the whole message shows, which needs it read before the rule can apply. */
export const readsMessage = (rule: Rule) => [rule.match, ...(rule.except ?? [])].some((m) => CONTENT_FACTS.some((key) => m.facts?.[key] !== undefined));

/**
 * What the user wants for mail matching `match`. A rule says what the mail is (`labelId`), what happens
 * to it (`disposition`), or both; or, with `whenLabel`, what happens to it only when some tier has said
 * it is that label. It carries at least one of the three.
 *
 * - `labelId` alone: the mail is that label, and the label's action applies.
 * - `disposition` alone: do this, whatever the mail is. It is labelled only if that costs nothing.
 * - `labelId` and `disposition`: the mail is that label, with this action instead of the label's.
 * - `whenLabel`: applies only to mail a tier labelled `whenLabel`. With `disposition`, that action
 *   replaces the label's; without, the label's action is confirmed as the user's own.
 */
export interface Rule {
  id: string;
  match: RuleMatch;
  /** If any of these match, the rule does not apply. */
  except?: RuleMatch[];
  labelId?: string;
  whenLabel?: string;
  disposition?: DecidedDisposition;
  /** `unsubscribe` adds that to what happens, for mail this rule decides. */
  subscription?: SubscriptionAction;
  /** Also mark the mail read, when it is kept or archived. */
  markRead?: boolean;
  /** A condition in plain language ("auction notices for lots I did not bid on"). Only a model can apply it, and it needs `labelId` for the model to answer with. */
  when?: string;
  /** Mild made this rule itself, when it blocked the sender. The user's own rules are trusted further. */
  learned?: boolean;
  /** What the user calls it ("Shop receipts"), said in place of its conditions. */
  name?: string;
}

/** A display name as rules compare it. */
export const plainName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

function matches(match: RuleMatch, facts: MessageFacts): boolean {
  const checks: boolean[] = [];
  const any = (...fits: boolean[][]) => {
    const all = fits.flat();
    if (all.length > 0) checks.push(all.some(Boolean));
  };
  any(
    (match.from ?? []).map((a) => facts.from.address === a.toLowerCase()),
    (match.fromDomain ?? []).map((d) => facts.from.domain === d.toLowerCase()),
  );
  const name = plainName(facts.from.name ?? '');
  any(
    (match.fromName ?? []).map((n) => name === plainName(n)),
    (match.fromNameContains ?? []).map((n) => name.includes(plainName(n))),
  );
  any((match.to ?? []).map((to) => facts.to.some((a) => a.address === to.toLowerCase())));
  const list = parseListId(facts.headers['list-id']);
  any((match.listId ?? []).map((id) => list === id.toLowerCase()));
  const subject = facts.subject.toLowerCase();
  any((match.subjectContains ?? []).map((words) => subject.includes(words.toLowerCase())));
  const asked = factsOf(match);
  if (asked) checks.push(matchesFacts(asked, facts.known ?? deriveFacts(facts)));
  return checks.length > 0 && checks.every(Boolean);
}

/** Whether a match names who sent it by name alone, which anyone can claim. An exception may: its rule names the sender. */
export const nameAlone = (match: RuleMatch) => (has(match.fromName) || has(match.fromNameContains)) && !has(match.from) && !has(match.fromDomain);

export function applies(rule: Rule, facts: MessageFacts): boolean {
  return !nameAlone(rule.match) && matches(rule.match, facts) && !(rule.except ?? []).some((e) => matches(e, facts));
}

const either = (values: readonly string[]) => values.join(' or ');

/** A rule's conditions in words, for the audit log and the dashboard: "from a@example.com or domain example.org, is a reply". */
export function describeMatch(match: RuleMatch): string {
  const sender = [...(match.from ?? []), ...(match.fromDomain ?? []).map((d) => `domain ${d}`)];
  const name = [...(match.fromName ?? []).map((n) => `named ${n}`), ...(match.fromNameContains ?? []).map((n) => `name contains ${n}`)];
  const named = [
    ...(sender.length > 0 ? [`from ${either(sender)}`] : []),
    ...(name.length > 0 ? [either(name)] : []),
    ...(has(match.to) ? [`to ${either(match.to)}`] : []),
    ...(has(match.listId) ? [`list ${either(match.listId)}`] : []),
    ...(has(match.subjectContains) ? [`subject contains ${either(match.subjectContains)}`] : []),
  ];
  const facts = Object.entries(factsOf(match) ?? {}).flatMap(([key, want]) => factCondition(key, want) ?? []);
  return [...named, ...facts].join(', ');
}

/**
 * How narrowly a match is drawn. A condition on who sent it, their name, to whom, the list or the subject
 * counts 2; exact senders 1 more than a domain, and an exact name 1 more than part of one; a fact counts 1,
 * since one fact ("is a reply") takes in mail from anyone. A condition with several values counts as one
 * with one: a tie goes to the earlier rule either way.
 */
export const specificity = (match: RuleMatch) =>
  [
    has(match.from) || has(match.fromDomain),
    has(match.fromName) || has(match.fromNameContains),
    has(match.to),
    has(match.listId),
    has(match.subjectContains),
  ].filter(Boolean).length *
    2 +
  (has(match.from) && !has(match.fromDomain) ? 1 : 0) +
  (has(match.fromName) && !has(match.fromNameContains) ? 1 : 0) +
  Object.values(factsOf(match) ?? {}).filter((v) => v !== undefined).length;
