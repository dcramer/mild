import type { Sql } from '../store/sql.ts';
import { reconcile } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import type { FilterCheck } from '../actions/rule-filters.ts';
import type { UnsubscribeOutcome } from '../actions/unsubscribe.ts';
import type { Judge } from '../triage/stages/model.ts';
import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import { type Account, listAccounts, listUsers } from '../store/accounts.ts';
import type { Store } from '../store/store.ts';
import { EXAMPLE_KEEP_DAYS, pruneExamples } from '../store/examples.ts';
import { purgeSuggestionBodies } from '../store/messages.ts';
import { preferences } from '../store/preferences.ts';
import { KEEP_BODY_DAYS, keepSuggestionBodies } from './bodies.ts';
import { captureExamples } from './examples.ts';
import { PRUNE_PER_RUN, RETENTION_DAYS, pruneOld } from './retention.ts';
import { checkFiltersWhenDue } from './filters.ts';
import { recordPassStatus } from './status.ts';
import type { Job, Jobs } from './jobs.ts';
import { type SyncReport, syncAccount } from './sync.ts';
import { type TriageReport, triageAccount } from './triage.ts';

export interface RunOptions {
  ephemeral: Ephemeral;
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
/** A minute: new mail is classified soon after it lands, and a quiet pass costs a history read per mailbox. */
const PASS_INTERVAL_MS = 60_000;
/** How long a pass holds its mailbox: longer than a pass should take, and how long one that dies keeps it. */
const PASS_HOLD_MS = 15 * 60_000;

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

/** One pass over each mailbox in one person's database, one after another. A mailbox another pass holds is left out. */
export async function runOnce(db: Sql, options: RunOptions): Promise<PassResult[]> {
  const results: PassResult[] = [];
  for (const account of await listAccounts(db)) {
    const result = await passMailbox(db, account, options);
    if (result) results.push(result);
  }
  return results;
}

/** Run one job. One for a person or mailbox that is gone does nothing. */
export async function runJob(store: Store, job: Job, options: RunOptions): Promise<PassResult | null> {
  if (!(await stillThere(store, job.person))) return null;
  const db = await store.user(job.person);
  if (job.kind === 'upkeep') {
    await upkeep(db, options);
    return null;
  }
  const account = (await listAccounts(db)).find((a) => a.id === job.account);
  return account ? await passMailbox(db, account, options) : null;
}

/** Null when another pass holds the mailbox, or it was removed while this one ran. */
async function passMailbox(db: Sql, account: Account, options: RunOptions): Promise<PassResult | null> {
  const lock = `lock:pass:${account.id}`;
  const token = await options.ephemeral.claim(lock, PASS_HOLD_MS);
  if (token === null) return null;
  try {
    const result = await runMailbox(db, account, options);
    if (result)
      await recordPassStatus(options.ephemeral, account.id, {
        at: (options.now ?? Date.now)(),
        ...(result.error ? { error: result.error } : {}),
        ...(result.expired ? { expired: true } : {}),
      });
    return result;
  } finally {
    await options.ephemeral.release(lock, token);
  }
}

/**
 * One pass over one mailbox, changing Gmail only if its person has sift on: settle unconfirmed actions,
 * sync, triage. A failure is reported; the next pass picks up where this one stopped.
 */
async function runMailbox(db: Sql, account: Account, options: RunOptions): Promise<PassResult | null> {
  const leave = options.unsubscribe;
  const { active } = await preferences(db);
  const tier = options.model ? await options.model(db) : null;
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
    if (!(await listAccounts(db)).some((a) => a.id === account.id)) return null;
    result.error = error instanceof Error ? error.message : String(error);
    // Google's answer when a refresh token is no longer good; an app left in Testing does this every 7 days.
    if (result.error.includes('invalid_grant')) {
      result.expired = true;
      options.log(`${account.email}: Google sign-in has expired. Sign in to the dashboard again.`);
    } else options.log(`${account.email}: pass failed, will retry: ${result.error}`);
  }
  return result;
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

/** One person's upkeep, sent when sift starts and once a day after: old examples, message text and messages go. */
export async function upkeep(db: Sql, options: Pick<RunOptions, 'log' | 'now'>): Promise<void> {
  const now = (options.now ?? Date.now)();
  const dropped = await pruneExamples(db, now);
  if (dropped > 0) options.log(`Deleted ${dropped} example${dropped === 1 ? '' : 's'} older than ${EXAMPLE_KEEP_DAYS} days`);
  await purgeSuggestionBodies(db, now - KEEP_BODY_DAYS * DAY_MS);
  let pruned: number;
  do {
    pruned = await pruneOld(db, now);
    if (pruned > 0) options.log(`Forgot ${pruned} message${pruned === 1 ? '' : 's'} with nothing newer than ${RETENTION_DAYS} days`);
  } while (pruned >= PRUNE_PER_RUN);
}

/**
 * Until `signal` aborts, send a pass for every mailbox each interval, or sooner when woken, and upkeep for
 * everyone when it starts and once a day after. Whoever is added or removed is seen at the next send.
 */
export async function runLoop(store: Store, jobs: Jobs, control: { signal: AbortSignal; wake: Wake; now?: () => number }): Promise<void> {
  const now = control.now ?? Date.now;
  let upkeepAt = -Infinity;
  while (!control.signal.aborted) {
    const due = now() - upkeepAt >= DAY_MS;
    if (due) upkeepAt = now();
    for (const user of await listUsers(store.central)) {
      if (due) jobs.send({ kind: 'upkeep', person: user.id });
      for (const account of await listAccounts(await store.user(user.id))) jobs.send({ kind: 'pass', person: user.id, account: account.id });
    }
    await control.wake.wait(PASS_INTERVAL_MS, control.signal);
  }
}
