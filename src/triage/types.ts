/** What happens to the message in the mailbox. `review` means no stage was sure: leave it in place and ask. */
export type Disposition = 'keep' | 'archive' | 'spam' | 'review';

/** A disposition a stage may assert on its own. Only the pipeline falls back to `review`. */
export type DecidedDisposition = Exclude<Disposition, 'review'>;

/** Chosen independently of the disposition: a kept sender can still be unsubscribed from. */
export type SubscriptionAction = 'preserve' | 'unsubscribe';

export type StageName = 'rules' | 'sender' | 'classifier' | 'agent' | 'fallback';

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
}

export interface Decision {
  disposition: Disposition;
  subscription: SubscriptionAction;
  /** User-facing label to apply, e.g. `sift/newsletters`. */
  label?: string;
  stage: StageName;
  /** Human-readable explanation, stored in the audit log. */
  reason: string;
  ruleId?: string;
  confidence?: number;
  /** The category the model tier chose, when it decided. */
  category?: string;
  /** Set by a stage that used a model, so the cost of every decision is on record. */
  usage?: DecisionUsage;
}

export interface DecisionUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** One tier of the cascade. Returning null abstains and passes the message to the next tier. */
export interface Stage {
  name: StageName;
  decide(facts: MessageFacts): Decision | null | Promise<Decision | null>;
}
