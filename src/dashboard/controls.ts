import type { Sql } from '../store/sql.ts';

/**
 * What the dashboard can ask the rest of sift to do. The dashboard itself may not import Gmail, the
 * action executor or the daemon, so the process that starts it hands these in. Anything that changes
 * the mailbox goes through here and is audited like any other change. `db` is the database of whoever
 * asked, which is where the thing named is looked for.
 */
export interface Controls {
  /** The models this person's sign-ins offer, and for each provider the one to suggest first. */
  models(db: Sql): Promise<{ models: string[]; recommended: Record<string, string> }>;
  /** The ways to reach a model, which of them this person has signed in to, and a ChatGPT sign-in under way. */
  modelSignIns(db: Sql): Promise<ModelSignIns>;
  /**
   * Start signing this person in to ChatGPT, the install's one way. Resolves with where to go, and for a
   * device code the code to enter there; that completes in the background, a redirect by `finishChatGPT`.
   */
  signInChatGPT(db: Sql): Promise<PendingChatGPT>;
  /** Finish this person's Sign in with ChatGPT with the address their browser was sent back to. Rejects with what went wrong. */
  finishChatGPT(db: Sql, address: string): Promise<void>;
  /** Store an API key for one of the providers that takes one. */
  saveModelKey(db: Sql, provider: string, key: string): Promise<void>;
  signOutModel(db: Sql, provider: string): Promise<void>;
  /** Reverse one mailbox change. Resolves with a sentence describing what happened. */
  undo(db: Sql, actionId: number): Promise<string>;
  /** Pull the last `days` days of everyone's inbox in as suggestions. Resolves with how many messages were new. */
  backfill(days: number): Promise<number>;
  /**
   * After the user has corrected a decision: take back what sift last did to that message, so the new
   * decision can be carried out from where the message started. Resolves with whether anything was taken back.
   */
  putBack(db: Sql, accountId: string, messageId: string): Promise<boolean>;
  /**
   * Replay the model over an account's stored examples, in the background. Every example is a model call
   * that costs money, so this only ever runs because the user asked. Resolves with the run's id.
   */
  startEval(db: Sql, request: { accountId: string; fewShot: boolean; limit: number }): Promise<number>;
  /**
   * Copy a rule to Gmail as a filter (`on`), or take its filter out again. Rejects with a sentence for
   * the user when the rule cannot be a filter or Gmail refused.
   */
  ruleFilter(db: Sql, ruleId: string, on: boolean): Promise<void>;
  /**
   * Revoke sift's Gmail access to one of this person's mailboxes at Google, before it is removed, and stop
   * reporting on it. Resolves false when Google could not be reached; the mailbox is removed anyway.
   */
  revokeGmail(db: Sql, email: string): Promise<boolean>;
  /**
   * One of this person's messages as Gmail holds its HTML part, raw, to be cleaned and shown while it is
   * open. Nothing keeps or logs it. Null when it has no HTML part or is no longer in Gmail.
   */
  messageHtml(db: Sql, accountId: string, messageId: string): Promise<string | null>;
  /** Start a pass now instead of waiting for the interval. */
  checkNow(): void;
  activity(): Activity;
}

export interface Activity {
  /** False when only the dashboard is running, with nothing sorting mail. */
  running: boolean;
  lastPassAt: number | null;
  /** What went wrong on the last pass, per account. Empty when it went well. */
  problems: string[];
  /** Addresses of accounts whose Google sign-in expired, as of the last pass. Each must sign in again. */
  expired: string[];
}

/**
 * Signing in with Google from the browser. One sign-in does two things: it gives sift its access to the
 * Gmail account, and it proves the viewer owns that account, which is what lets them use the dashboard.
 */
export interface SignIn {
  hasClient(): boolean;
  /** Google's sign-in address for a browser that should come back to `redirectUri`. */
  url(redirectUri: string, state: string, challenge: string): string;
  /** False for an address the user's allow list leaves out. Asked on every request, so a session ends when its address is taken off the list. */
  allowed(email: string): boolean;
  /**
   * Finish a sign-in. The account must be `allowed`. One sift does not know is connected: as another
   * mailbox of `addTo` (the address of whoever is signed in and asked to add it), or else as a new
   * person's, where that is permitted. Resolves with the account's address; rejects with a message for the user.
   */
  complete(redirectUri: string, code: string, verifier: string, addTo: string | null): Promise<string>;
}

export interface ModelSignIns {
  choices: { provider: string; label: string; how: 'device-code' | 'redirect' | 'key' }[];
  /** Providers this person has a sign-in for. */
  signedIn: string[];
  /** A ChatGPT sign-in waiting on them, or how the last one failed. */
  pending: PendingChatGPT | { error: string } | null;
}

/** Where to sign in to ChatGPT, until when, and by device code the code to enter there. */
export interface PendingChatGPT {
  code?: string;
  url: string;
  expiresAt: number;
}
