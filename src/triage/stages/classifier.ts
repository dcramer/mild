import type { DecidedDisposition, MessageFacts, Stage } from '../types.ts';

export interface Classification {
  disposition: DecidedDisposition;
  label?: string;
  /** Calibrated probability of `disposition`, 0 to 1. */
  confidence: number;
}

/** Port for a decision model (Jev, Clef, or a local classifier). Returns null on error: errors abstain. */
export type Classify = (facts: MessageFacts) => Promise<Classification | null>;

export interface ClassifierOptions {
  /** Below this the stage abstains. `spam` uses `minSpamConfidence`. */
  minConfidence: number;
  /** Spam is the costliest mistake, so it gets its own, higher bar. */
  minSpamConfidence: number;
}

export function classifierStage(classify: Classify, options: ClassifierOptions): Stage {
  return {
    name: 'classifier',
    async decide(facts) {
      const result = await classify(facts);
      if (!result) return null;
      const bar = result.disposition === 'spam' ? options.minSpamConfidence : options.minConfidence;
      if (result.confidence < bar) return null;
      return {
        disposition: result.disposition,
        subscription: 'preserve',
        ...(result.label ? { label: result.label } : {}),
        stage: 'classifier',
        confidence: result.confidence,
        reason: `classifier chose ${result.disposition} at ${result.confidence.toFixed(2)}`,
      };
    },
  };
}
