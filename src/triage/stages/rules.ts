import { type DecidedDisposition, type Decision, type Label, LEAVE_IN_INBOX, type MessageFacts, type Stage, labelled } from '../types.ts';
import { type Rule, applies, describeMatch, specificity } from '../rule.ts';

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

type Outcome = Pick<Decision, 'disposition' | 'subscription' | 'labelId' | 'gmailLabel' | 'block' | 'digest' | 'markRead'> & { ruleId: string };

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
  return {
    disposition,
    subscription: 'preserve',
    ...(found ? { labelId: found.id, ...(found.gmailLabel ? { gmailLabel: found.gmailLabel } : {}) } : {}),
    ...extras(disposition),
  };
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
  const who = rule.name ?? describeMatch(rule.match);
  // Leave in inbox is not a kind of mail, so it is said as what happens.
  const is = rule.labelId === LEAVE_IN_INBOX ? ': leave it in the inbox' : ` is ${label?.name ?? rule.labelId}`;
  if (rule.when) return `${who}, when it is ${rule.when}${is}`;
  if (rule.whenLabel) return `${who}, when it is ${label?.name ?? rule.whenLabel}${rule.disposition ? `: ${DOES[rule.disposition]}` : ''}`;
  if (rule.labelId) return `${who}${is}${rule.disposition ? `, but ${DOES[rule.disposition]}` : ''}`;
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
  const { block: _block, digest: _digest, markRead: _markRead, ...rest } = decision;
  return { ...rest, ...outcome, reason: `rule: ${describeRule(hit)}. ${decision.reason}` };
}
