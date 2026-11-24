import type { Facts } from './facts.ts';

/** What happens to the message in the mailbox. `review` means no stage was sure: leave it in place and ask. */
export const DISPOSITIONS = ['keep', 'archive', 'spam', 'review'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** A disposition a stage may assert on its own. Only the pipeline falls back to `review`. */
export const DECIDED = ['keep', 'archive', 'spam'] as const;
export type DecidedDisposition = (typeof DECIDED)[number];

/** Chosen independently of the disposition: a kept sender can still be unsubscribed from. */
export const SUBSCRIPTION_ACTIONS = ['preserve', 'unsubscribe'] as const;
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number];

export const STAGE_NAMES = ['rules', 'classifier', 'model', 'fallback'] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface Address {
  /** Lowercased `local@domain`. */
  address: string;
  /** Lowercased domain part. */
  domain: string;
  name?: string;
}

/** Everything a stage may look at. Built from Gmail `format=metadata`; never contains the body. */
export interface MessageFacts {
  accountId: string;
  messageId: string;
  threadId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  labelIds: string[];
  /** Header names lowercased. */
  headers: Record<string, string>;
  /** Epoch milliseconds. */
  receivedAt: number;
  /** What Mild has recorded about it. Absent for mail not yet recorded, whose headers say the same. */
  known?: Facts;
}

export interface Decision {
  disposition: Disposition;
  subscription: SubscriptionAction;
  /** What the mail is: a label's id. Absent only when no tier could place it. */
  labelId?: string;
  /** That label's name in Gmail, e.g. `mild/newsletters`. */
  gmailLabel?: string;
  /** With `spam`: also treat everything from this sender as spam from now on. */
  block?: boolean;
  /** With `archive`: also list it in its label's next digest. */
  digest?: boolean;
  /** With `keep` or `archive`: also mark the message read. */
  markRead?: boolean;
  stage: StageName;
  /** Human-readable explanation, stored in the audit log. */
  reason: string;
  ruleId?: string;
  confidence?: number;
}

/**
 * Leave in inbox: the one choice every mailbox has that is not a label of the person's, for mail that is none
 * of their labels. Mild's own, and nothing about it changes. It always keeps and has no Gmail label, so mail put
 * there by mistake is where it would have been without Mild. The id is from when it was called Everything Else;
 * ids never change.
 */
export const LEAVE_IN_INBOX = 'everything_else';
export const LEAVE_IN_INBOX_NAME = 'Leave in inbox';

/** A kind of mail, and what the user wants done with it. Every tier names one of these; none picks an action. */
export interface Label {
  id: string;
  name: string;
  /** How to recognise it. Shown to the model. */
  description: string;
  /** What Mild does with mail that carries this label. */
  disposition: Disposition;
  /** Absent only for Leave in inbox, which would be on most of the inbox and say nothing. */
  gmailLabel?: string;
  /** With `spam`: block the sender, so their later mail is spam without being judged again. */
  block?: boolean;
  /** With `archive`: list the mail in one message a day instead (src/work/digest.ts). */
  digest?: boolean;
  /** With `keep` or `archive`: mark the mail read as well. */
  markRead?: boolean;
  /** Also leave the sender's mailing list, where that can be done safely. */
  unsubscribe?: boolean;
}

/** The part of a decision that follows from the label, with `override` in place of the label's own action if given. */
export function labelled(
  label: Label,
  override?: DecidedDisposition,
): Pick<Decision, 'disposition' | 'subscription' | 'labelId' | 'gmailLabel' | 'block' | 'digest' | 'markRead'> {
  const disposition = override ?? label.disposition;
  // Keeping mail its label would move says it is wanted, so the label's unsubscribe and mark read do not come with it.
  const wanted = override === 'keep' && label.disposition !== 'keep';
  return {
    disposition,
    subscription: label.unsubscribe && !wanted ? 'unsubscribe' : 'preserve',
    labelId: label.id,
    ...(label.gmailLabel ? { gmailLabel: label.gmailLabel } : {}),
    // An exception replaces the label's action, so it does not inherit the block or the digest.
    ...(label.block && override === undefined && disposition === 'spam' ? { block: true } : {}),
    ...(label.digest && override === undefined && disposition === 'archive' ? { digest: true } : {}),
    ...(label.markRead && !wanted && (disposition === 'keep' || disposition === 'archive') ? { markRead: true } : {}),
  };
}

/** A tier that could not finish (its model call failed). Nothing is decided, and the message is tried again on a later pass. */
export interface Unfinished {
  unfinished: string;
}

/** One tier of the cascade. Returning null abstains and passes the message to the next tier. */
export interface Stage<R extends Decision | Unfinished = Decision> {
  name: StageName;
  decide(facts: MessageFacts): R | null | Promise<R | null>;
}

/** What a call cost, as the provider reported it. */
export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
