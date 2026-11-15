import { type Label, type MessageFacts, type Stage, labelled } from '../types.ts';

export interface Classification {
  /** A label's id. */
  labelId: string;
  /** Calibrated probability that the label is right, 0 to 1. */
  confidence: number;
}

/** Port for a decision model (Jev, Clef, or a local classifier). Returns null on error: errors abstain. */
export type Classify = (facts: MessageFacts) => Promise<Classification | null>;

export interface ClassifierOptions {
  /** Below this the stage abstains. Labels whose action is `spam` use `minSpamConfidence`. */
  minConfidence: number;
  /** Spam is the costliest mistake, so it gets its own, higher bar. */
  minSpamConfidence: number;
}

export function classifierStage(classify: Classify, labels: readonly Label[], options: ClassifierOptions): Stage {
  return {
    name: 'classifier',
    async decide(facts) {
      const result = await classify(facts);
      const label = result && labels.find((l) => l.id === result.labelId);
      if (!result || !label) return null;
      const bar = label.disposition === 'spam' ? options.minSpamConfidence : options.minConfidence;
      if (result.confidence < bar) return null;
      return {
        ...labelled(label),
        subscription: 'preserve',
        stage: 'classifier',
        confidence: result.confidence,
        reason: `classifier chose ${label.name} at ${result.confidence.toFixed(2)}`,
      };
    },
  };
}
