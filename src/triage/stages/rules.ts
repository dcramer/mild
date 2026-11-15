import { parseListId } from '../features.ts';
import { type DecidedDisposition, type Label, type MessageFacts, type Stage, type SubscriptionAction, labelled } from '../types.ts';

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
  subscription?: SubscriptionAction;
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

export interface RulesOptions {
  /** Whether the owner has ever written to the sender. Undefined means not known. */
  hasWritten?: (facts: MessageFacts) => boolean | undefined;
}

/**
 * Deterministic rules, the user's and the ones sift learned. A rule whose outcome is `keep` is a
 * protection and beats every other match; otherwise the first match in order wins. A rule whose label
 * no longer exists is ignored, and a learned rule never hides mail from someone the owner has written to.
 */
export function rulesStage(rules: readonly Rule[], labels: readonly Label[], options: RulesOptions = {}): Stage {
  return {
    name: 'rules',
    decide(facts) {
      const hits = rules.flatMap((rule) => {
        const label = labels.find((l) => l.id === rule.labelId);
        if (!label || !applies(rule, facts)) return [];
        const outcome = labelled(label, rule.disposition);
        const hides = outcome.disposition === 'archive' || outcome.disposition === 'spam';
        if (rule.learned && hides && options.hasWritten?.(facts) === true) return [];
        return [{ rule, label, outcome }];
      });
      const hit = hits.find((h) => h.outcome.disposition === 'keep') ?? hits[0];
      if (!hit) return null;
      return {
        ...hit.outcome,
        subscription: hit.rule.subscription ?? 'preserve',
        stage: 'rules',
        ruleId: hit.rule.id,
        reason: `${hit.rule.learned ? 'learned' : 'rule'}: ${describeMatch(hit.rule.match)} is ${hit.label.name}`,
      };
    },
  };
}
