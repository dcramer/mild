import type { DatabaseSync } from 'node:sqlite';
import { reconcile } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import type { UnsubscribeOutcome } from '../actions/unsubscribe.ts';
import type { Judge } from '../triage/stages/model.ts';
import { type Account, listAccounts } from '../store/accounts.ts';
import { keepSuggestionBodies } from './bodies.ts';
import { captureExamples } from './examples.ts';
import { type SyncReport, syncAccount } from './sync.ts';
import { type TriageReport, triageAccount } from './triage.ts';

export interface RunOptions {
  /** False observes: mail is synced and decisions recorded, but the mailbox is never changed. */
  act: boolean;
  /** Opens a provider connection for an account. */
  connect: (account: Account) => { api: GmailApi; mailbox: Mailbox };
  /** The inference tier, if a model is configured. */
  model?: { judge: Judge; guidelines: () => string };
  /** Label plainly bulk mail by its headers before the model. Off unless set. */
  heuristics?: boolean;
  /** Leaves a mailing list, for decisions that say to. Without it sift never unsubscribes. */
  unsubscribe?: (accountId: string, messageId: string) => Promise<UnsubscribeOutcome>;
  log: (line: string) => void;
  now?: () => number;
}

export interface PassResult {
  email: string;
  sync?: SyncReport;
  triage?: TriageReport;
  /** Marked messages whose full content was stored this pass. */
  captured?: number;
  error?: string;
}

/**
 * One pass over every account: settle unconfirmed actions, sync, triage. An account that fails is
 * reported and the others still run; the next pass picks up where it stopped.
 */
export async function runOnce(db: DatabaseSync, options: RunOptions): Promise<PassResult[]> {
  const results: PassResult[] = [];
  for (const account of listAccounts(db)) {
    const result: PassResult = { email: account.email };
    try {
      const { api, mailbox } = options.connect(account);
      const deps = { db, mailbox, ...(options.now ? { now: options.now } : {}) };
      if (options.act) await reconcile(deps);
      result.sync = await syncAccount(db, api, account);
      result.triage = await triageAccount(
        {
          ...deps,
          mailbox: options.act ? mailbox : null,
          ...(options.unsubscribe ? { unsubscribe: options.unsubscribe } : {}),
          ...(options.heuristics ? { heuristics: { mailbox } } : {}),
          ...(options.model ? { model: { judge: options.model.judge, guidelines: options.model.guidelines(), sources: { api, mailbox } } } : {}),
        },
        account,
      );
      result.captured = await captureExamples(db, api, account.id, options.now);
      await keepSuggestionBodies(db, api, account.id, options.now);
      const line = describe(result, options.act);
      if (line) options.log(`${account.email}: ${line}`);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      // Google's answer when a refresh token is no longer good; an app left in Testing does this every 7 days.
      if (result.error.includes('invalid_grant')) options.log(`${account.email}: Google sign-in has expired. Sign in to the dashboard again.`);
      else options.log(`${account.email}: pass failed, will retry: ${result.error}`);
    }
    results.push(result);
  }
  return results;
}

/** A one-line summary of a pass, or null when nothing happened. */
function describe(result: PassResult, act: boolean): string | null {
  const parts: string[] = [];
  const { sync, triage } = result;
  if (sync?.mode === 'recovery') parts.push('history cursor had expired, searched the last 7 days');
  if (sync && sync.added.length > 0) parts.push(`${sync.added.length} new`);
  if (triage) {
    const decided = Object.entries(triage.decided).filter(([, n]) => n > 0);
    if (decided.length > 0) parts.push(`${act ? 'decided' : 'would'} ${decided.map(([d, n]) => `${d} ${n}`).join(', ')}`);
    if (triage.acted > 0) parts.push(`${triage.acted} changed`);
    if (triage.skipped > 0) parts.push(`${triage.skipped} skipped`);
    if (triage.learned > 0) parts.push(`learned ${triage.learned} rule${triage.learned === 1 ? '' : 's'}`);
    if (triage.unsubscribed > 0) parts.push(`unsubscribed from ${triage.unsubscribed} sender${triage.unsubscribed === 1 ? '' : 's'}`);
    if (triage.blocked > 0) parts.push(`blocked ${triage.blocked} sender${triage.blocked === 1 ? '' : 's'}`);
    if (triage.troubled > 0) parts.push(`${triage.troubled} need attention (see sift log)`);
  }
  if (result.captured) parts.push(`stored ${result.captured} marked message${result.captured === 1 ? '' : 's'} as examples`);
  return parts.length > 0 ? parts.join('; ') : null;
}

/** Lets something outside the loop cut a wait short, for "check now". */
export interface Wake {
  /** Resolve after `ms`, or sooner if `now()` is called or `signal` aborts. */
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => void;
}

export function createWake(): Wake {
  let wakeUp: (() => void) | null = null;
  return {
    now: () => wakeUp?.(),
    wait: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          wakeUp = null;
          resolve();
        };
        const timer = setTimeout(done, ms);
        wakeUp = done;
        signal.addEventListener('abort', done, { once: true });
      }),
  };
}

/**
 * Run passes until `signal` aborts. `next` is asked before every pass, so a change to the settings
 * (acting or observing, the model, the interval) takes effect on the following pass without a restart.
 */
export async function runLoop(
  db: DatabaseSync,
  next: () => Promise<RunOptions & { intervalMs: number }>,
  control: { signal: AbortSignal; wake: Wake; onPass?: (results: PassResult[]) => void },
): Promise<void> {
  while (!control.signal.aborted) {
    const options = await next();
    control.onPass?.(await runOnce(db, options));
    await control.wake.wait(options.intervalMs, control.signal);
  }
}
