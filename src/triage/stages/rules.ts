import { parseListId } from '../features.ts';
import { type DecidedDisposition, type Label, type MessageFacts, type Stage, type SubscriptionAction, labelled } from '../types.ts';

export type RuleTier = 'always' | 'usually';

/** Every condition present must hold. A match with no conditions never matches. */
export interface RuleMatch {
  /** Exact sender address. */
  from?: string;
  /** Exact sender domain (no subdomain matching). */
  fromDomain?: string;
  /** Exact address in To. Cc does not count. */
  to?: string;
  listId?: string;
  /** Case-insensitive substring of the subject. */
  subjectContains?: string;
}

/** Mail matching `match` is `labelId`. What happens to it is the label's action, unless the rule carries its own. */
export interface Rule {
  id: string;
  match: RuleMatch;
  /** If any of these match, the rule does not apply. */
  except?: RuleMatch[];
  labelId: string;
  /** An exception to the label's action, for this rule only. */
  disposition?: DecidedDisposition;
  /** `unsubscribe` adds that to what the label does, for mail this rule matches. */
  subscription?: SubscriptionAction;
  /** Also mark the mail read, when it is kept or archived, whether or not the label does. */
  markRead?: boolean;
  /**
   * `always` (the default) decides by itself. `usually` is a prior: when a model tier follows, the model
   * is told and still reads each message, so the odd one that is something else is not swept up.
   */
  tier?: RuleTier;
  /** A condition in plain language ("auction notices for lots I did not bid on"). Only a model can apply it. */
  when?: string;
  /** sift made this rule itself, from what a model kept deciding. The user's own rules are trusted further. */
  learned?: boolean;
}

export function matches(match: RuleMatch, facts: MessageFacts): boolean {
  const checks: boolean[] = [];
  if (match.from !== undefined) checks.push(facts.from.address === match.from.toLowerCase());
  if (match.fromDomain !== undefined) checks.push(facts.from.domain === match.fromDomain.toLowerCase());
  if (match.to !== undefined) {
    const to = match.to.toLowerCase();
    checks.push(facts.to.some((a) => a.address === to));
  }
  if (match.listId !== undefined) checks.push(parseListId(facts.headers['list-id']) === match.listId.toLowerCase());
  if (match.subjectContains !== undefined) checks.push(facts.subject.toLowerCase().includes(match.subjectContains.toLowerCase()));
  return checks.length > 0 && checks.every(Boolean);
}

function applies(rule: Rule, facts: MessageFacts): boolean {
  return matches(rule.match, facts) && !(rule.except ?? []).some((e) => matches(e, facts));
}

const CONDITION: Record<keyof RuleMatch, string> = { from: 'from', fromDomain: 'from domain', to: 'to', listId: 'list', subjectContains: 'subject contains' };

/** A rule's conditions in words, for the audit log and the dashboard. */
export function describeMatch(match: RuleMatch): string {
  return (Object.keys(CONDITION) as (keyof RuleMatch)[])
    .filter((key) => match[key] !== undefined)
    .map((key) => `${CONDITION[key]} ${match[key]}`)
    .join(', ');
}

/** How narrowly a match is drawn: each condition counts, and an exact sender counts for more than a domain. */
const specificity = (match: RuleMatch) => Object.values(match).filter((v) => v !== undefined).length * 2 + (match.from === undefined ? 0 : 1);

export interface RulesOptions {
  /** Whether the owner has ever written to the sender. Undefined means not known. */
  hasWritten?: (facts: MessageFacts) => boolean | undefined;
}

export interface RuleHit {
  rule: Rule;
  label: Label;
}

/** Whether a rule needs a model to apply it. */
export const isJudged = (rule: Rule) => rule.tier === 'usually' || rule.when !== undefined;

/** What a rule does to mail it applies to: its label's action, its own exception, and its extras on top. */
export function ruleOutcome({ rule, label }: RuleHit): ReturnType<typeof labelled> & { ruleId: string } {
  const outcome = labelled(label, rule.disposition);
  const stays = outcome.disposition === 'keep' || outcome.disposition === 'archive';
  return {
    ...outcome,
    // A rule's extras add to its label's; they never take one away.
    ...(rule.subscription === 'unsubscribe' ? { subscription: 'unsubscribe' as const } : {}),
    ...(rule.markRead && stays ? { markRead: true } : {}),
    ruleId: rule.id,
  };
}

/**
 * The rule that speaks for a message, if any. A rule whose outcome is `keep` is a protection and beats
 * every other match. Otherwise the most specific match wins (more conditions, then an exact sender over
 * a domain), so "this sender when the subject contains X" beats "this sender" whichever was written
 * first; ties go to the earlier rule. A rule whose label no longer exists is ignored, and a learned rule
 * never hides mail from someone the owner has written to.
 */
export function pickRule(rules: readonly Rule[], labels: readonly Label[], facts: MessageFacts, options: RulesOptions = {}): RuleHit | null {
  const hits = rules.flatMap((rule) => {
    const label = labels.find((l) => l.id === rule.labelId);
    if (!label || !applies(rule, facts)) return [];
    const { disposition } = labelled(label, rule.disposition);
    const hides = disposition === 'archive' || disposition === 'spam';
    if (rule.learned && hides && options.hasWritten?.(facts) === true) return [];
    return [{ rule, label, keeps: disposition === 'keep' }];
  });
  const ranked = hits.toSorted((a, b) => specificity(b.rule.match) - specificity(a.rule.match));
  // Only a rule that decides by itself can protect: a judged one may turn out not to apply.
  return ranked.find((h) => h.keeps && !isJudged(h.rule)) ?? ranked[0] ?? null;
}

/** A rule's conditions and what it says, in words. */
export function describeRule({ rule, label }: RuleHit): string {
  const when = rule.when ? `, when it is ${rule.when},` : '';
  return `${describeMatch(rule.match)}${when} is ${rule.tier === 'usually' ? 'usually ' : ''}${label.name}`;
}

/**
 * Deterministic rules. `judged` says a model tier follows: then a rule that needs judging abstains here
 * and reaches the model as a prior. Without a model, a `usually` rule is all there is and decides; a
 * rule with a plain-language condition cannot be applied at all.
 */
export function rulesStage(rules: readonly Rule[], labels: readonly Label[], options: RulesOptions & { judged?: boolean } = {}): Stage {
  return {
    name: 'rules',
    decide(facts) {
      const hit = pickRule(rules, labels, facts, options);
      if (!hit || hit.rule.when !== undefined || (options.judged && isJudged(hit.rule))) return null;
      return { ...ruleOutcome(hit), stage: 'rules', reason: `${hit.rule.learned ? 'learned' : 'rule'}: ${describeRule(hit)}` };
    },
  };
}
