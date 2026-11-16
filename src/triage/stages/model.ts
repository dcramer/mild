import type { Facts } from '../facts.ts';
import type { Standing } from '../standing.ts';
import { type RuleHit, describeRule, ruleOutcome } from './rules.ts';
import { type Shot, pickShots } from '../fewshot.ts';
import { type DecisionUsage, type Disposition, type Label, type MessageFacts, type Stage, labelled } from '../types.ts';

/** Everything the model is shown about one message. Gathered by deterministic code, never by the model. */
export interface Evidence {
  facts: MessageFacts;
  known: Facts;
  /** Plain text of the message, truncated. Null if it could not be fetched. Untrusted. */
  body: string | null;
  sender: {
    /** Messages sift has recorded from this address, including this one. */
    messagesSeen: number;
    /** Whether the account owner has ever written to this address. Null if that could not be checked. */
    userHasWritten: boolean | null;
    /** What sift did with earlier mail from this address. */
    pastDispositions: Partial<Record<Disposition, number>>;
    /** How the owner regards them, and why. Absent when it was not worked out. */
    standing?: { standing: Standing; why: string };
    /** What their earlier mail was, by label id, most first. */
    pastLabels?: { id: string; messages: number }[];
    firstSeenAt?: number | null;
  };
  /** The same for everyone at the sender's domain. Absent for a domain anyone can get an address at. */
  domain?: { messages: number; senders: number; standing: Standing; why: string; pastLabels: { id: string; messages: number }[] };
  /** What the owner's rule says this sender's mail usually is. The model may find this message is something else. */
  prior?: { labelId: string; labelName: string; when?: string };
}

export const UNSURE = 'unsure';

export interface Verdict {
  /** A label's id, or `unsure`. */
  label: string;
  reason: string;
  /** 0 to 1, as reported by the model. Not calibrated. */
  confidence?: number;
  usage?: DecisionUsage;
}

/** Port for the model. Returns null when the call failed or the answer was unusable: that abstains. */
export type Judge = (input: JudgeInput) => Promise<Verdict | null>;

export interface JudgeInput {
  evidence: Evidence;
  labels: readonly Label[];
  guidelines: string;
  /** Mail the owner labelled before, shown to the model as examples. Already chosen and cut to size. */
  examples?: readonly Shot[];
}

export interface ModelStageDeps {
  gather: (facts: MessageFacts) => Promise<Evidence>;
  /** The judged rule that speaks for a message, if any. */
  prior?: (facts: MessageFacts) => RuleHit | null;
  judge: Judge;
  labels: readonly Label[];
  /** The user's broad guidance in plain language. May be empty. */
  guidelines: string;
  /** Port for labelled examples that might help with this message. The stage picks from what it returns. Omitted: none are shown. */
  examples?: (facts: MessageFacts) => readonly Shot[] | Promise<readonly Shot[]>;
}

/**
 * The inference tier. The model has no tools and takes no action: it reads the evidence and names a
 * label. What happens next is that label's action, and two protections apply whatever the model says.
 */
export function modelStage(deps: ModelStageDeps): Stage {
  return {
    name: 'agent',
    async decide(facts) {
      const prior = deps.prior?.(facts) ?? null;
      const gathered = await deps.gather(facts);
      const evidence: Evidence = prior
        ? { ...gathered, prior: { labelId: prior.label.id, labelName: prior.label.name, ...(prior.rule.when ? { when: prior.rule.when } : {}) } }
        : gathered;
      const examples = deps.examples ? pickShots(await deps.examples(facts), facts, deps.labels) : [];
      const verdict = await deps.judge({ evidence, labels: deps.labels, guidelines: deps.guidelines, ...(examples.length > 0 ? { examples } : {}) });
      if (!verdict) return null;

      const base = {
        subscription: 'preserve' as const,
        stage: 'agent' as const,
        ...(prior ? { priorRuleId: prior.rule.id } : {}),
        ...(verdict.confidence === undefined ? {} : { confidence: verdict.confidence }),
        ...(verdict.usage ? { usage: verdict.usage } : {}),
      };
      // The model agrees with the owner's rule: the rule's outcome applies. A rule the owner made is trusted
      // to hide mail; one sift learned is not, and falls through to the protection below.
      if (prior && verdict.label === prior.label.id && !prior.rule.learned)
        return { ...base, ...ruleOutcome(prior), reason: `rule: ${describeRule(prior)}. ${verdict.reason}` };
      const unusual = prior && verdict.label !== prior.label.id ? `not the usual ${prior.label.name}. ` : '';

      const label = deps.labels.find((l) => l.id === verdict.label);
      // `unsure`, or a label that does not exist: the model could not place it, so the user decides.
      if (!label)
        return {
          ...base,
          disposition: 'review',
          reason: unusual + (verdict.label === UNSURE ? verdict.reason : `model named an unknown label: ${verdict.reason}`),
        };

      const outcome = labelled(label);
      const hides = outcome.disposition === 'archive' || outcome.disposition === 'spam';
      // Mail from someone the user has written to is never hidden on a model's word. Unknown counts as yes.
      if (hides && evidence.sender.userHasWritten !== false) {
        const why = evidence.sender.userHasWritten === null ? 'could not check whether you have written to this sender' : 'you have written to this sender';
        return {
          ...base,
          disposition: 'review',
          labelId: label.id,
          gmailLabel: label.gmailLabel,
          reason: `${unusual}${label.name}, but ${why}: ${verdict.reason}`,
        };
      }

      // Nor is a reply in a conversation the owner has taken part in, whoever sent it.
      if (hides && evidence.known.ownerInThread)
        return {
          ...base,
          disposition: 'review',
          labelId: label.id,
          gmailLabel: label.gmailLabel,
          reason: `${unusual}${label.name}, but you have written in this thread: ${verdict.reason}`,
        };

      return { ...base, ...outcome, reason: `${unusual}${label.name}: ${verdict.reason}` };
    },
  };
}
