import type { BulkSignals } from '../features.ts';
import type { DecisionUsage, Disposition, MessageFacts, Stage } from '../types.ts';

/** A kind of mail and what the user wants done with it. */
export interface Category {
  key: string;
  name: string;
  /** How to recognise it. Shown to the model. */
  description: string;
  disposition: Disposition;
  label?: string;
}

/** Everything the model is shown about one message. Gathered by deterministic code, never by the model. */
export interface Evidence {
  facts: MessageFacts;
  signals: BulkSignals;
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
  /** A category key, or `unsure`. */
  category: string;
  reason: string;
  /** 0 to 1, as reported by the model. Not calibrated. */
  confidence?: number;
  usage?: DecisionUsage;
}

/** Port for the model. Returns null when the call failed or the answer was unusable: that abstains. */
export type Judge = (input: { evidence: Evidence; categories: readonly Category[]; guidelines: string }) => Promise<Verdict | null>;

export interface ModelStageDeps {
  gather: (facts: MessageFacts) => Promise<Evidence>;
  judge: Judge;
  categories: readonly Category[];
  /** The user's broad guidance in plain language. May be empty. */
  guidelines: string;
}

/**
 * The inference tier. The model has no tools and takes no action: it reads the evidence and names a
 * category. What happens next comes from the user's settings for that category, and two protections
 * apply whatever the model says.
 */
export function modelStage(deps: ModelStageDeps): Stage {
  return {
    name: 'agent',
    async decide(facts) {
      const evidence = await deps.gather(facts);
      const verdict = await deps.judge({ evidence, categories: deps.categories, guidelines: deps.guidelines });
      if (!verdict) return null;

      const base = {
        subscription: 'preserve' as const,
        stage: 'agent' as const,
        ...(verdict.confidence === undefined ? {} : { confidence: verdict.confidence }),
        ...(verdict.usage ? { usage: verdict.usage } : {}),
      };
      const category = deps.categories.find((c) => c.key === verdict.category);
      // `unsure`, or a category that does not exist: the model could not place it, so the user decides.
      if (!category)
        return { ...base, disposition: 'review', reason: verdict.category === UNSURE ? verdict.reason : `model named an unknown category: ${verdict.reason}` };

      const hides = category.disposition === 'archive' || category.disposition === 'spam';
      // Mail from someone the user has written to is never hidden on a model's word. Unknown counts as yes.
      if (hides && evidence.sender.userHasWritten !== false) {
        const why = evidence.sender.userHasWritten === null ? 'could not check whether you have written to this sender' : 'you have written to this sender';
        return { ...base, disposition: 'review', category: category.key, reason: `${category.name}, but ${why}: ${verdict.reason}` };
      }

      return {
        ...base,
        disposition: category.disposition,
        category: category.key,
        ...(category.label ? { label: category.label } : {}),
        reason: `${category.name}: ${verdict.reason}`,
      };
    },
  };
}
