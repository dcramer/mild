import type { Facts } from '../facts.ts';
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
  };
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
export type Judge = (input: { evidence: Evidence; labels: readonly Label[]; guidelines: string }) => Promise<Verdict | null>;

export interface ModelStageDeps {
  gather: (facts: MessageFacts) => Promise<Evidence>;
  judge: Judge;
  labels: readonly Label[];
  /** The user's broad guidance in plain language. May be empty. */
  guidelines: string;
}

/**
 * The inference tier. The model has no tools and takes no action: it reads the evidence and names a
 * label. What happens next is that label's action, and two protections apply whatever the model says.
 */
export function modelStage(deps: ModelStageDeps): Stage {
  return {
    name: 'agent',
    async decide(facts) {
      const evidence = await deps.gather(facts);
      const verdict = await deps.judge({ evidence, labels: deps.labels, guidelines: deps.guidelines });
      if (!verdict) return null;

      const base = {
        subscription: 'preserve' as const,
        stage: 'agent' as const,
        ...(verdict.confidence === undefined ? {} : { confidence: verdict.confidence }),
        ...(verdict.usage ? { usage: verdict.usage } : {}),
      };
      const label = deps.labels.find((l) => l.id === verdict.label);
      // `unsure`, or a label that does not exist: the model could not place it, so the user decides.
      if (!label)
        return { ...base, disposition: 'review', reason: verdict.label === UNSURE ? verdict.reason : `model named an unknown label: ${verdict.reason}` };

      const outcome = labelled(label);
      const hides = outcome.disposition === 'archive' || outcome.disposition === 'spam';
      // Mail from someone the user has written to is never hidden on a model's word. Unknown counts as yes.
      if (hides && evidence.sender.userHasWritten !== false) {
        const why = evidence.sender.userHasWritten === null ? 'could not check whether you have written to this sender' : 'you have written to this sender';
        return { ...base, disposition: 'review', labelId: label.id, gmailLabel: label.gmailLabel, reason: `${label.name}, but ${why}: ${verdict.reason}` };
      }

      // Nor is a reply in a conversation the owner has taken part in, whoever sent it.
      if (hides && evidence.known.ownerInThread)
        return {
          ...base,
          disposition: 'review',
          labelId: label.id,
          gmailLabel: label.gmailLabel,
          reason: `${label.name}, but you have written in this thread: ${verdict.reason}`,
        };

      return { ...base, ...outcome, reason: `${label.name}: ${verdict.reason}` };
    },
  };
}
