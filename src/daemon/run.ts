import type { DatabaseSync } from 'node:sqlite';
import { reconcile } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import type { Judge } from '../triage/stages/model.ts';
import { type Account, listAccounts } from '../store/accounts.ts';
import { type SyncReport, syncAccount } from './sync.ts';
import { type TriageReport, triageAccount } from './triage.ts';

export interface RunOptions {
  /** False observes: mail is synced and decisions recorded, but the mailbox is never changed. */
  act: boolean;
  /** Opens a provider connection for an account. */
  connect: (account: Account) => { api: GmailApi; mailbox: Mailbox };
  /** The inference tier, if a model is configured. */
  model?: { judge: Judge; guidelines: () => string };
  log: (line: string) => void;
  now?: () => number;
}

export interface PassResult {
  email: string;
  sync?: SyncReport;
  triage?: TriageReport;
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
          ...(options.model ? { model: { judge: options.model.judge, guidelines: options.model.guidelines(), sources: { api, mailbox } } } : {}),
        },
        account,
      );
      const line = describe(result, options.act);
      if (line) options.log(`${account.email}: ${line}`);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      options.log(`${account.email}: pass failed, will retry: ${result.error}`);
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
    if (triage.learned > 0) parts.push(`learned ${triage.learned} sender${triage.learned === 1 ? '' : 's'}`);
    if (triage.troubled > 0) parts.push(`${triage.troubled} need attention (see sift log)`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/** Run passes until `signal` aborts. Waits `intervalMs` between the end of one pass and the start of the next. */
export async function runLoop(db: DatabaseSync, options: RunOptions & { intervalMs: number; signal: AbortSignal }): Promise<void> {
  while (!options.signal.aborted) {
    await runOnce(db, options);
    await new Promise<void>((resolve) => {
      if (options.signal.aborted) return resolve();
      const timer = setTimeout(done, options.intervalMs);
      function done() {
        clearTimeout(timer);
        options.signal.removeEventListener('abort', done);
        resolve();
      }
      options.signal.addEventListener('abort', done, { once: true });
    });
  }
}
