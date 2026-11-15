/**
 * What the dashboard can ask the rest of sift to do. The dashboard itself may not import Gmail, the
 * action executor or the daemon, so the process that starts it hands these in. Anything that changes
 * the mailbox goes through here and is audited like any other change.
 */
export interface Controls {
  settings(): ManagedSettings;
  /** Save a change to `sift.toml`. A running sift picks it up on its next pass. */
  saveSettings(change: Partial<ManagedSettings>): void;
  /** `provider/model-id` for every model the signed-in providers offer. */
  models(): Promise<string[]>;
  guidelines(): string;
  saveGuidelines(text: string): void;
  /** Reverse one mailbox change. Resolves with a sentence describing what happened. */
  undo(actionId: number): Promise<string>;
  /** Pull the last `days` days of the inbox in as suggestions. Resolves with how many messages were new. */
  backfill(days: number): Promise<number>;
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
}

export interface Activity {
  /** False when only the dashboard is running, with nothing sorting mail. */
  sorting: boolean;
  lastPassAt: number | null;
  /** What went wrong on the last pass, per account. Empty when it went well. */
  problems: string[];
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
  /**
   * Finish a sign-in. The account must already be connected, unless none is yet or `allowNew` is set, in
   * which case it is connected. Resolves with the account's address; rejects with a message for the user.
   */
  complete(redirectUri: string, code: string, verifier: string, allowNew: boolean): Promise<string>;
}
