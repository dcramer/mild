import type { Sql } from '../store/sql.ts';
import { reconcile } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import type { FilterCheck } from '../actions/rule-filters.ts';
import type { UnsubscribeOutcome } from '../actions/unsubscribe.ts';
import type { Judge } from '../triage/stages/model.ts';
import { type Account, listAccounts, listUsers } from '../store/accounts.ts';
import type { Store } from '../store/store.ts';
import { EXAMPLE_KEEP_DAYS, pruneExamples } from '../store/examples.ts';
import { purgeSuggestionBodies } from '../store/messages.ts';
import { preferences } from '../store/preferences.ts';
import { KEEP_BODY_DAYS, keepSuggestionBodies } from './bodies.ts';
import { captureExamples } from './examples.ts';
import { PRUNE_PER_RUN, RETENTION_DAYS, pruneOld } from './retention.ts';
import { checkFiltersWhenDue } from './filters.ts';
import { type SyncReport, syncAccount } from './sync.ts';
import { type TriageReport, triageAccount } from './triage.ts';

export interface RunOptions {
  /** Opens a provider connection for an account, with the sign-in kept in `db`, its person's database. */
  connect: (db: Sql, account: Account) => { api: GmailApi; mailbox: Mailbox } | Promise<{ api: GmailApi; mailbox: Mailbox }>;
  /** The inference tier of the person whose database `db` is: null when they have no model, or it cannot be reached. */
  model?: (db: Sql) => Promise<{ judge: Judge; model: string } | null>;
  /** Leaves a mailing list, for decisions that say to. Without it sift never unsubscribes. */
  unsubscribe?: (db: Sql, accountId: string, messageId: string) => Promise<UnsubscribeOutcome>;
  log: (line: string) => void;
  now?: () => number;
}

const DAY_MS = 86_400_000;
/** A minute: new mail is sorted soon after it lands, and a quiet pass costs a history read per mailbox. */
const PASS_INTERVAL_MS = 60_000;

export interface PassResult {
  email: string;
  sync?: SyncReport;
  triage?: TriageReport;
  /** Marked messages whose full content was stored this pass. */
  captured?: number;
  /** What a look at the account's Gmail filters found, on the passes that looked. */
  filters?: FilterCheck;
  error?: string;
  /** The error is Google refusing sift's sign-in for this account. Retrying will not help; signing in again will. */
  expired?: true;
}

/** Whether a person is still there: one deleted while a pass ran is skipped, not reported. */
const stillThere = async (store: Store, id: number) => (await listUsers(store.central)).some((u) => u.id === id);

/** One pass over everyone's mailboxes, a person's database at a time. */
export async function runEveryone(store: Store, options: RunOptions): Promise<PassResult[]> {
  const results: PassResult[] = [];
  for (const user of await listUsers(store.central)) {
    try {
      results.push(...(await runOnce(await store.user(user.id), options)));
    } catch (error) {
      if (await stillThere(store, user.id)) throw error;
    }
  }
  return results;
}

/**
 * One pass over the mailboxes in one person's database, changing Gmail only if they have sift on: settle
 * unconfirmed actions, sync, triage. An account that fails is reported and the others still run; the
 * next pass picks up where it stopped.
 */
export async function runOnce(db: Sql, options: RunOptions): Promise<PassResult[]> {
  const results: PassResult[] = [];
  const leave = options.unsubscribe;
  const { active } = await preferences(db);
  const tier = options.model ? await options.model(db) : null;
  for (const account of await listAccounts(db)) {
    const result: PassResult = { email: account.email };
    try {
      const { api, mailbox } = await options.connect(db, account);
      const deps = { db, mailbox, ...(options.now ? { now: options.now } : {}) };
      if (active) await reconcile(deps);
      result.sync = await syncAccount(db, api, account, options.now);
      result.triage = await triageAccount(
        {
          ...deps,
          mailbox: active ? mailbox : null,
          answers: mailbox,
          ...(leave ? { unsubscribe: (accountId: string, messageId: string) => leave(db, accountId, messageId) } : {}),
          sources: { api, mailbox },
          ...(tier ? { model: { judge: tier.judge, model: tier.model } } : {}),
        },
        account,
      );
      result.captured = await captureExamples(db, api, account.id, options.now);
      await keepSuggestionBodies(db, api, account.id, options.now);
      try {
        const filters = await checkFiltersWhenDue(deps, account.id, active);
        if (filters) result.filters = filters;
      } catch (error) {
        // The mail was still triaged; the filters are looked at again next pass.
        options.log(`${account.email}: could not check Gmail filters: ${error instanceof Error ? error.message : String(error)}`);
      }
      const line = describe(result, active);
      if (line) options.log(`${account.email}: ${line}`);
    } catch (error) {
      // Removed while the pass ran: there is nothing left to report about.
      if (!(await listAccounts(db)).some((a) => a.id === account.id)) continue;
      result.error = error instanceof Error ? error.message : String(error);
      // Google's answer when a refresh token is no longer good; an app left in Testing does this every 7 days.
      if (result.error.includes('invalid_grant')) {
        result.expired = true;
        options.log(`${account.email}: Google sign-in has expired. Sign in to the dashboard again.`);
      } else options.log(`${account.email}: pass failed, will retry: ${result.error}`);
    }
    results.push(result);
  }
  return results;
}

/** A one-line summary of a pass, or null when nothing happened. */
function describe(result: PassResult, active: boolean): string | null {
  const parts: string[] = [];
  const { sync, triage } = result;
  if (sync?.mode === 'recovery') parts.push('history cursor had expired, searched the last 7 days');
  if (sync && sync.added.length > 0) parts.push(`${sync.added.length} new`);
  if (sync?.corrections) parts.push(`learned from ${sync.corrections} message${sync.corrections === 1 ? '' : 's'} you moved or relabelled in Gmail`);
  if (triage) {
    const decided = Object.entries(triage.decided).filter(([, n]) => n > 0);
    if (decided.length > 0) parts.push(`${active ? 'decided' : 'would'} ${decided.map(([d, n]) => `${d} ${n}`).join(', ')}`);
    if (triage.acted > 0) parts.push(`${triage.acted} changed`);
    if (triage.skipped > 0) parts.push(`${triage.skipped} skipped`);
    if (triage.proposed > 0) parts.push(`proposed ${triage.proposed} rule${triage.proposed === 1 ? '' : 's'}`);
    if (triage.unsubscribed > 0) parts.push(`unsubscribed from ${triage.unsubscribed} sender${triage.unsubscribed === 1 ? '' : 's'}`);
    if (triage.blocked > 0) parts.push(`blocked ${triage.blocked} sender${triage.blocked === 1 ? '' : 's'}`);
    if (triage.unjudged > 0) parts.push(`the model failed on ${triage.unjudged}: ${triage.failure}`);
    if (triage.troubled > 0) parts.push(`${triage.troubled} need attention (see Changes in the dashboard)`);
  }
  if (result.captured) parts.push(`stored ${result.captured} marked message${result.captured === 1 ? '' : 's'} as examples`);
  const { filters } = result;
  if (filters?.gone) parts.push(`${filters.gone} filter${filters.gone === 1 ? '' : 's'} deleted in Gmail`);
  if (filters?.changed) parts.push(`${filters.changed} filter${filters.changed === 1 ? '' : 's'} changed in Gmail`);
  if (filters?.outdated)
    parts.push(`${filters.outdated} filter${filters.outdated === 1 ? '' : 's'} ${active ? 'brought into line with' : 'no longer match'} their rules`);
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

/** Upkeep that runs when sift starts and once a day after, for everyone, whether or not Gmail can be reached. */
export async function daily(store: Store, options: Pick<RunOptions, 'log' | 'now'>): Promise<void> {
  const now = (options.now ?? Date.now)();
  for (const user of await listUsers(store.central)) {
    try {
      const db = await store.user(user.id);
      const dropped = await pruneExamples(db, now);
      if (dropped > 0) options.log(`Deleted ${dropped} example${dropped === 1 ? '' : 's'} older than ${EXAMPLE_KEEP_DAYS} days`);
      await purgeSuggestionBodies(db, now - KEEP_BODY_DAYS * DAY_MS);
    } catch (error) {
      if (await stillThere(store, user.id))
        options.log(`Could not delete old examples and message text, will retry tomorrow: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Run passes until `signal` aborts. `next` is asked before every pass, and each person's choices are read
 * as their mail is, so a change takes effect on the following pass without a restart. Old records are
 * pruned on the first pass and then once a day.
 */
export async function runLoop(
  store: Store,
  next: () => Promise<RunOptions>,
  control: { signal: AbortSignal; wake: Wake; onPass?: (results: PassResult[]) => void | Promise<void> },
): Promise<void> {
  let prunedAt = -Infinity;
  let lastDaily = -Infinity;
  while (!control.signal.aborted) {
    const options = await next();
    const now = (options.now ?? Date.now)();
    if (now - lastDaily >= DAY_MS) {
      lastDaily = now;
      await daily(store, options);
    }
    await control.onPass?.(await runEveryone(store, options));
    // After the pass, which may have taken a while.
    const after = (options.now ?? Date.now)();
    if (after - prunedAt >= DAY_MS) {
      try {
        let backlog = false;
        for (const user of await listUsers(store.central)) {
          const pruned = await pruneOld(await store.user(user.id), after);
          if (pruned > 0) options.log(`Forgot ${pruned} message${pruned === 1 ? '' : 's'} with nothing newer than ${RETENTION_DAYS} days`);
          // A backlog goes a piece per pass.
          backlog ||= pruned >= PRUNE_PER_RUN;
        }
        if (!backlog) prunedAt = after;
      } catch (error) {
        prunedAt = after;
        options.log(`Could not prune old records, will retry tomorrow: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await control.wake.wait(PASS_INTERVAL_MS, control.signal);
  }
}
