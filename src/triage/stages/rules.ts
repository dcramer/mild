import { CONTENT_FACTS, type RuleFacts, deriveFacts, factCondition, matchesFacts } from '../facts.ts';
import { parseListId } from '../features.ts';
import { type DecidedDisposition, type Decision, type Label, type MessageFacts, type Stage, type SubscriptionAction, labelled } from '../types.ts';

/** Every condition present must hold. A match with no conditions never matches. */
export interface RuleMatch {
  /** Exact sender address. */
  from?: string;
  /** Exact sender domain (no subdomain matching). */
  fromDomain?: string;
  /**
   * The sender's display name, ignoring case and runs of spaces. Anyone can put any name on mail, so a rule
   * holds one only beside `from` or `fromDomain`, whose DMARC says who sent it.
   */
  fromName?: string;
  /** Case-insensitive substring of the sender's display name. Held only beside `from` or `fromDomain`, as `fromName` is. */
  fromNameContains?: string;
  /** Exact address in To. Cc does not count. */
  to?: string;
  listId?: string;
  /** Case-insensitive substring of the subject. */
  subjectContains?: string;
  /** What sift recorded about the message (`Facts`): each one named must have the answer given. */
  facts?: RuleFacts;
}

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
  /** sift made this rule itself, when it blocked the sender. The user's own rules are trusted further. */
  learned?: boolean;
}

/** A display name as rules compare it. */
export const plainName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

function matches(match: RuleMatch, facts: MessageFacts): boolean {
  const checks: boolean[] = [];
  if (match.from !== undefined) checks.push(facts.from.address === match.from.toLowerCase());
  if (match.fromDomain !== undefined) checks.push(facts.from.domain === match.fromDomain.toLowerCase());
  const name = plainName(facts.from.name ?? '');
  if (match.fromName !== undefined) checks.push(name === plainName(match.fromName));
  if (match.fromNameContains !== undefined) checks.push(name.includes(plainName(match.fromNameContains)));
  if (match.to !== undefined) {
    const to = match.to.toLowerCase();
    checks.push(facts.to.some((a) => a.address === to));
  }
  if (match.listId !== undefined) checks.push(parseListId(facts.headers['list-id']) === match.listId.toLowerCase());
  if (match.subjectContains !== undefined) checks.push(facts.subject.toLowerCase().includes(match.subjectContains.toLowerCase()));
  const asked = factsOf(match);
  if (asked) checks.push(matchesFacts(asked, facts.known ?? deriveFacts(facts)));
  return checks.length > 0 && checks.every(Boolean);
}

/** Whether a match names who sent it by name alone, which anyone can claim. An exception may: its rule names the sender. */
export const nameAlone = (match: RuleMatch) =>
  (match.fromName !== undefined || match.fromNameContains !== undefined) && match.from === undefined && match.fromDomain === undefined;

function applies(rule: Rule, facts: MessageFacts): boolean {
  return !nameAlone(rule.match) && matches(rule.match, facts) && !(rule.except ?? []).some((e) => matches(e, facts));
}

type Named = Exclude<keyof RuleMatch, 'facts'>;
const CONDITION: Record<Named, string> = {
  from: 'from',
  fromDomain: 'from domain',
  fromName: 'named',
  fromNameContains: 'name contains',
  to: 'to',
  listId: 'list',
  subjectContains: 'subject contains',
};

/** A rule's conditions in words, for the audit log and the dashboard: "from domain example.com, is a reply". */
export function describeMatch(match: RuleMatch): string {
  const named = (Object.keys(CONDITION) as Named[]).filter((key) => match[key] !== undefined).map((key) => `${CONDITION[key]} ${match[key]}`);
  const facts = Object.entries(factsOf(match) ?? {}).flatMap(([key, want]) => factCondition(key, want) ?? []);
  return [...named, ...facts].join(', ');
}

/**
 * How narrowly a match is drawn. A condition on who sent it, their name, to whom, the list or the subject
 * counts 2; an exact sender 1 more than a domain, and an exact name 1 more than part of one; a fact counts 1,
 * since one fact ("is a reply") takes in mail from anyone.
 */
export const specificity = (match: RuleMatch) =>
  (Object.keys(CONDITION) as Named[]).filter((key) => match[key] !== undefined).length * 2 +
  (match.from === undefined ? 0 : 1) +
  (match.fromName === undefined ? 0 : 1) +
  Object.values(factsOf(match) ?? {}).filter((v) => v !== undefined).length;

interface RulesOptions {
  /** Whether the owner has ever written to the sender. Undefined means not known. */
  hasWritten?: (facts: MessageFacts) => boolean | undefined;
}

export interface RuleHit {
  rule: Rule;
  /** The label the rule names or waits for. Absent for a rule that only says what happens. */
  label?: Label;
}

/** Whether a rule can only apply once something has said what the mail is: a model, for a condition in words; any tier, for `whenLabel`. */
const isJudged = (rule: Rule) => rule.whenLabel !== undefined || rule.when !== undefined;

type Outcome = Pick<Decision, 'disposition' | 'subscription' | 'labelId' | 'gmailLabel' | 'block' | 'markRead'> & { ruleId: string };

/**
 * What a rule does to mail it applies to. `found` is a label the mail is known to be from elsewhere, for
 * a rule that names none: the mail keeps it, and the rule's action stands.
 */
export function ruleOutcome({ rule, label }: RuleHit, found?: Label): Outcome {
  const extras = (disposition: Decision['disposition']) => ({
    // A rule's extras add to its label's; they never take one away.
    ...(rule.subscription === 'unsubscribe' ? { subscription: 'unsubscribe' as const } : {}),
    ...(rule.markRead && (disposition === 'keep' || disposition === 'archive') ? { markRead: true } : {}),
    ruleId: rule.id,
  });
  if (label) {
    const outcome = labelled(label, rule.disposition);
    return { ...outcome, ...extras(outcome.disposition) };
  }
  // Only what happens: the label's own extras are not the rule's to apply.
  const disposition = rule.disposition ?? 'keep';
  return { disposition, subscription: 'preserve', ...(found ? { labelId: found.id, gmailLabel: found.gmailLabel } : {}), ...extras(disposition) };
}

const keeps = (hit: RuleHit) => (hit.label ? labelled(hit.label, hit.rule.disposition).disposition : hit.rule.disposition) === 'keep';

/**
 * Every rule that could speak for a message, best first. A rule whose label no longer exists is left
 * out, as is a learned rule that would hide mail from someone the owner has written to. The most
 * specific match comes first (more conditions, then an exact sender over a domain, then a rule that
 * waits for a label over one that does not); ties go to the earlier rule.
 */
function rankRules(rules: readonly Rule[], labels: readonly Label[], facts: MessageFacts, options: RulesOptions = {}): RuleHit[] {
  const hits = rules.flatMap((rule): RuleHit[] => {
    if (!applies(rule, facts)) return [];
    const named = rule.labelId ?? rule.whenLabel;
    const label = named === undefined ? undefined : labels.find((l) => l.id === named);
    if (named !== undefined && !label) return [];
    if (!label && rule.disposition === undefined) return [];
    const disposition = label ? labelled(label, rule.disposition).disposition : rule.disposition;
    const hides = disposition === 'archive' || disposition === 'spam';
    if (rule.learned && hides && options.hasWritten?.(facts) === true) return [];
    return [label ? { rule, label } : { rule }];
  });
  const weight = ({ rule }: RuleHit) => specificity(rule.match) * 2 + (isJudged(rule) ? 1 : 0);
  return hits.toSorted((a, b) => weight(b) - weight(a));
}

/**
 * The rule that decides a message before anything has said what it is, or null. A rule that keeps mail
 * is a protection and beats every other match; otherwise the best match wins. If the best match can
 * only apply once the mail has a label, and `judged` says a tier that names labels follows, nothing is
 * decided here and `settle` finishes the job afterwards.
 */
function pickRule(rules: readonly Rule[], labels: readonly Label[], facts: MessageFacts, options: RulesOptions & { judged?: boolean } = {}): RuleHit | null {
  const ranked = rankRules(rules, labels, facts, options);
  const sure = ranked.filter((h) => !isJudged(h.rule));
  const protection = sure.find(keeps);
  if (protection) return protection;
  const [best] = ranked;
  if (!best) return null;
  if (isJudged(best.rule)) return options.judged ? null : (sure[0] ?? null);
  return best;
}

/** The judged rule a model should be told about, if the best match for a message is one. */
export function priorRule(rules: readonly Rule[], labels: readonly Label[], facts: MessageFacts, options: RulesOptions = {}): RuleHit | null {
  const ranked = rankRules(rules, labels, facts, options);
  if (ranked.some((h) => !isJudged(h.rule) && keeps(h))) return null;
  const [best] = ranked;
  return best && isJudged(best.rule) && best.label ? best : null;
}

const DOES: Record<DecidedDisposition, string> = { keep: 'keep it', archive: 'archive it', spam: 'mark it spam' };

/** A rule's conditions and what it says, in words. */
export function describeRule({ rule, label }: RuleHit): string {
  const who = describeMatch(rule.match);
  if (rule.when) return `${who}, when it is ${rule.when}, is ${label?.name ?? rule.labelId}`;
  if (rule.whenLabel) return `${who}, when it is ${label?.name ?? rule.whenLabel}${rule.disposition ? `: ${DOES[rule.disposition]}` : ''}`;
  if (rule.labelId) return `${who} is ${label?.name ?? rule.labelId}${rule.disposition ? `, but ${DOES[rule.disposition]}` : ''}`;
  return `${who}: ${DOES[rule.disposition ?? 'keep']}`;
}

/**
 * A label for mail that a rule only says what to do with, if one is to be had for nothing: from another
 * rule that names what this mail is.
 */
function freeLabel(ranked: readonly RuleHit[]): Label | undefined {
  return ranked.find((h) => h.rule.labelId !== undefined && !isJudged(h.rule) && h.label)?.label;
}

/**
 * Rules that decide by themselves. `judged` says a tier that names labels follows: then a message whose
 * best rule waits for a label is left for that tier, and `settle` applies the rule afterwards.
 */
export function rulesStage(rules: readonly Rule[], labels: readonly Label[], options: RulesOptions & { judged?: boolean } = {}): Stage {
  return {
    name: 'rules',
    decide(facts) {
      const hit = pickRule(rules, labels, facts, options);
      if (!hit) return null;
      const found = hit.label ? undefined : freeLabel(rankRules(rules, labels, facts, options));
      return { ...ruleOutcome(hit, found), stage: 'rules', reason: `${hit.rule.learned ? 'learned' : 'rule'}: ${describeRule(hit)}` };
    },
  };
}

/**
 * Apply the user's rules to a decision another tier made, now that the mail has a label: the best rule
 * that waits for exactly that label, or failing that one that decides by itself. The tier's label
 * stands; the rule says what happens. A decision with no label, or one a rule already made, is left as it is.
 */
export function settle(rules: readonly Rule[], labels: readonly Label[], facts: MessageFacts, decision: Decision, options: RulesOptions = {}): Decision {
  if (decision.stage === 'rules' || decision.labelId === undefined || decision.ruleId !== undefined) return decision;
  const said = labels.find((l) => l.id === decision.labelId);
  if (!said) return decision;
  const usable = rankRules(rules, labels, facts, options).filter(
    (h) => h.rule.when === undefined && (h.rule.whenLabel === undefined || h.rule.whenLabel === said.id),
  );
  const hit = usable.find(keeps) ?? usable[0];
  if (!hit) return decision;
  // A rule that names a different label than the tier found is the user saying what this mail is.
  const outcome = hit.rule.whenLabel !== undefined || hit.rule.labelId === undefined ? ruleOutcome({ rule: hit.rule, label: said }) : ruleOutcome(hit);
  const { block: _block, markRead: _markRead, ...rest } = decision;
  return { ...rest, ...outcome, reason: `rule: ${describeRule(hit)}. ${decision.reason}` };
}
