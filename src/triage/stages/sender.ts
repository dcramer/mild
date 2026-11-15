import type { DecidedDisposition, MessageFacts, Stage } from '../types.ts';

/** What sift has learned about one sender for one account. */
export interface SenderRecord {
  disposition: DecidedDisposition;
  label?: string;
  category?: string;
  /** True if the account owner has ever sent mail to this address. */
  userHasReplied: boolean;
}

export type SenderLookup = (facts: MessageFacts) => SenderRecord | null | Promise<SenderRecord | null>;

/**
 * Learned per-sender disposition. A sender the user has written to is never hidden on memory alone:
 * the stage abstains so a later tier (or the user) decides.
 */
export function senderStage(lookup: SenderLookup): Stage {
  return {
    name: 'sender',
    async decide(facts) {
      const record = await lookup(facts);
      if (!record) return null;
      if (record.userHasReplied && record.disposition !== 'keep') return null;
      return {
        disposition: record.disposition,
        subscription: 'preserve',
        ...(record.label ? { label: record.label } : {}),
        ...(record.category ? { category: record.category } : {}),
        stage: 'sender',
        reason: `learned disposition for ${facts.from.address}`,
      };
    },
  };
}
