import type { Sql } from '../store/sql.ts';

/**
 * What the dashboard can ask the rest of sift to do. The dashboard itself may not import Gmail, the
 * action executor or the daemon, so the process that starts it hands these in. Anything that changes
 * the mailbox goes through here and is audited like any other change. `db` is the database of whoever
 * asked, which is where the thing named is looked for.
 */
export interface Controls {
  settings(): ManagedSettings;
  /** Save a change to `sift.toml`. A running sift picks it up on its next pass. */
  saveSettings(change: Partial<ManagedSettings>): void;
  /** `provider/model-id` for every model the signed-in providers offer. */
  models(): Promise<string[]>;
  guidelines(): string;
  saveGuidelines(text: string): void;
  /** When the guidelines last changed, or null if there are none. */
  guidelinesChangedAt(): number | null;
  /**
   * Judge again, in the background, an account's waiting suggestions that were judged before the
   * guidelines last changed. A model call each, so only when the user asks, and at most a batch at a
   * time. Resolves with how many were started and how many are left for another press.
   */
  rejudge(db: Sql, accountId: string): Promise<{ started: number; remaining: number }>;
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
  /** Start a pass now instead of waiting for the interval. */
  checkNow(): void;
  activity(): Activity;
}

export interface ManagedSettings {
  /** False: sift only suggests. True: it carries decisions out in Gmail. */
  act: boolean;
  /** Seconds between passes. */
  interval: number;
  /** `provider/model-id`, or null for no model. */
  model: string | null;
  /** Whether the model is shown messages the user labelled before as examples. */
  fewShot: boolean;
  /** Days an example is kept after the user answered for it, or null to keep them. */
  examplesKeepDays: number | null;
}

export interface Activity {
  /** False when only the dashboard is running, with nothing sorting mail. */
  sorting: boolean;
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
  /** The kind of Google client that is set up, or null if none is. */
  client(): 'web' | 'desktop' | null;
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
