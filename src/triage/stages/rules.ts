import { parseListId } from '../features.ts';
import type { DecidedDisposition, MessageFacts, Stage, SubscriptionAction } from '../types.ts';

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

export interface Rule {
  id: string;
  match: RuleMatch;
  /** If any of these match, the rule does not apply. */
  except?: RuleMatch[];
  disposition: DecidedDisposition;
  subscription?: SubscriptionAction;
  label?: string;
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

/**
 * Local deterministic rules. A matching `keep` rule is a protection and beats every other match;
 * otherwise the first matching rule in order wins.
 */
export function rulesStage(rules: readonly Rule[]): Stage {
  return {
    name: 'rules',
    decide(facts) {
      const hits = rules.filter((rule) => applies(rule, facts));
      const rule = hits.find((r) => r.disposition === 'keep') ?? hits[0];
      if (!rule) return null;
      return {
        disposition: rule.disposition,
        subscription: rule.subscription ?? 'preserve',
        ...(rule.label ? { label: rule.label } : {}),
        stage: 'rules',
        ruleId: rule.id,
        reason: `matched rule ${rule.id}`,
      };
    },
  };
}
