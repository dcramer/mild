/**
 * The JSON the dashboard API returns. This file has no imports so the web app can share it.
 */

export const STAGES = ['rules', 'sender', 'classifier', 'agent', 'fallback'] as const;
export type StageKey = (typeof STAGES)[number];

export interface Summary {
  days: number;
  generatedAt: number;
  accounts: { email: string; lastSyncedAt: number | null }[];
  totals: {
    /** Messages received in the window. */
    messages: number;
    /** Decisions made in the window. */
    decisions: number;
    /** Of those, how many used no model at all. */
    withoutInference: number;
    costUsd: number;
    /** Recorded messages with no decision yet (all time). */
    awaitingTriage: number;
    openQuestions: number;
    /** Actions in the window that failed or whose outcome is unconfirmed. */
    troubledActions: number;
  };
  byStage: { stage: StageKey; decisions: number; costUsd: number; tokens: number }[];
  byDisposition: { disposition: string; decisions: number }[];
  /** One entry per day in the window, oldest first, with a count for every stage. */
  daily: { day: string; counts: Record<StageKey, number> }[];
  topSenders: { address: string; messages: number; lastDisposition: string | null }[];
  /** The ten latest decisions in the window. */
  recent: DecisionRow[];
}

export interface DecisionRow {
  id: number;
  accountId: string;
  messageId: string;
  decidedAt: number;
  stage: StageKey;
  disposition: string;
  label: string | null;
  reason: string;
  confidence: number | null;
  model: string | null;
  costUsd: number;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  /** `observe`: recorded only. `act`: meant to be carried out. */
  mode: string;
  /** Null while an `act` decision is still waiting to be carried out. */
  outcome: string | null;
  outcomeDetail: string | null;
  actionId: number | null;
  actionType: string | null;
  actionStatus: string | null;
}

export interface MessageDetail {
  accountId: string;
  messageId: string;
  threadId: string;
  fromAddress: string;
  fromName: string | null;
  to: { address: string; name?: string }[];
  cc: { address: string; name?: string }[];
  subject: string;
  listId: string | null;
  receivedAt: number;
  syncedAt: number | null;
  /** Triage headers as synced. Never the body. */
  headers: Record<string, string>;
  /** Every decision made about this message, oldest first. */
  decisions: (DecisionRow & { ruleId: string | null; inputTokens: number; outputTokens: number; durationMs: number | null })[];
  /** Every mailbox change made to this message, oldest first. */
  actions: {
    id: number;
    type: string;
    status: string;
    decisionId: number | null;
    added: string[];
    removed: string[];
    originalLabels: string[];
    finalLabels: string[] | null;
    error: string | null;
    createdAt: number;
  }[];
}

export interface RuleSummary {
  id: string;
  accountId: string;
  match: Record<string, string>;
  except: Record<string, string>[];
  disposition: string;
  label: string | null;
  source: string;
  hits: number;
  lastHitAt: number | null;
  /** Set once the rule has been promoted to a Gmail filter. */
  filterId: string | null;
  createdAt: number;
}

/** Mail from one sender that sift would treat the same way, waiting for the user to confirm or correct. */
export interface SuggestionGroup {
  accountId: string;
  sender: string;
  senderName: string | null;
  /** What sift would do. `review` means it had no suggestion. */
  disposition: string;
  category: string | null;
  label: string | null;
  stage: StageKey;
  messages: number;
  latestAt: number;
  /** The newest few, for context. */
  sample: { decisionId: number; messageId: string; subject: string; reason: string; decidedAt: number }[];
}

export interface Suggestions {
  groups: SuggestionGroup[];
  /** Messages waiting across all groups. */
  waiting: number;
  /** From the user's answers so far. */
  accuracy: { reviewed: number; right: number };
  /** The kinds of mail the user can say something is, per account, with what sift does for each. */
  categories: Record<string, { key: string; name: string; disposition: string }[]>;
  /** Marked messages kept whole as examples, and how many are still to be fetched. */
  examples: { captured: number; pending: number };
}

/** The body of POST /api/feedback. */
export interface FeedbackRequest {
  accountId: string;
  sender: string;
  verdict: 'right' | 'wrong';
  suggested?: string;
  correct?: string;
  /** The kind of mail it is; what happens follows from that category's setting. */
  category?: string;
  scope: 'sender' | 'message';
  decisionId?: number;
}
