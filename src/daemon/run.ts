import { setTimeout as sleep } from 'node:timers/promises';
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
import { continueEval, goingEvals } from '../learn/evals.ts';
import { backfill } from './backfill.ts';
import { checkFiltersWhenDue } from './filters.ts';
import { recordPassStatus } from './status.ts';
import type { Job, Jobs } from './jobs.ts';
import { type SyncReport, syncAccount } from './sync.ts';
import { type TriageReport, triageAccount } from './triage.ts';

export interface RunOptions {
  ephemeral: Ephemeral;
  /** Where follow-ups go: a pass that stops at its time limit sends itself again. */
  jobs: Jobs;
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
/** The same for a slice of a test run. */
const EVAL_HOLD_MS = 15 * 60_000;

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
  /** Stopped at its time limit with work left. */
  unfinished?: true;
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
    const result = await passMailbox(db, account, options, Infinity);
    if (result) results.push(result);
  }
  return results;
}

/**
 * Run one job, starting nothing new after `until`: a hosted queue's function has a time limit, and the
 * local queue sets one too so this path is the same everywhere. One for a person or mailbox that is gone does nothing.
 */
export async function runJob(store: Store, job: Job, options: RunOptions, until: number): Promise<PassResult | null> {
  if (!(await stillThere(store, job.person))) return null;
  const db = await store.user(job.person);
  switch (job.kind) {
    case 'upkeep':
      await upkeep(db, options);
      return null;
    case 'eval':
      await carryOnEval(db, job, options, until);
      return null;
    case 'backfill': {
      const account = (await listAccounts(db)).find((a) => a.id === job.account);
      if (!account) return null;
      const { api } = await options.connect(db, account);
      // Done: the next pass decides what came in, now rather than at the next tick.
      options.jobs.send((await backfill(db, api, account.id, job.days, until, options.now)) ? { kind: 'pass', person: job.person, account: account.id } : job);
      return null;
    }
    case 'pass': {
      const account = (await listAccounts(db)).find((a) => a.id === job.account);
      const result = account ? await passMailbox(db, account, options, until) : null;
      if (result?.unfinished) options.jobs.send(job);
      return result;
    }
  }
}

/** One slice of a test run, by whichever job holds it; sent again while there is more. */
async function carryOnEval(db: Sql, job: Extract<Job, { kind: 'eval' }>, options: RunOptions, until: number): Promise<void> {
  const lock = `lock:eval:${job.person}:${job.run}`;
  const token = await options.ephemeral.claim(lock, EVAL_HOLD_MS);
  if (token === null) return;
  try {
    const tier = options.model ? await options.model(db) : null;
    if (!tier) return;
    const over = await continueEval({ db, judge: tier.judge, model: tier.model, ...(options.now ? { now: options.now } : {}) }, job.run, until);
    if (!over) options.jobs.send(job);
  } finally {
    await options.ephemeral.release(lock, token);
  }
}

/** Null when another pass holds the mailbox, or it was removed while this one ran. */
async function passMailbox(db: Sql, account: Account, options: RunOptions, until: number): Promise<PassResult | null> {
  const lock = `lock:pass:${account.id}`;
  const token = await options.ephemeral.claim(lock, PASS_HOLD_MS);
  if (token === null) return null;
  try {
    const result = await runMailbox(db, account, options, until);
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
async function runMailbox(db: Sql, account: Account, options: RunOptions, until: number): Promise<PassResult | null> {
  const leave = options.unsubscribe;
  const over = () => (options.now ?? Date.now)() >= until;
  const { active } = await preferences(db);
  const tier = options.model ? await options.model(db) : null;
  const result: PassResult = { email: account.email };
  try {
    const { api, mailbox } = await options.connect(db, account);
    const deps = { db, mailbox, ...(options.now ? { now: options.now } : {}) };
    if (active) await reconcile(deps);
    result.sync = await syncAccount(db, api, account, options.now, until);
    if (result.sync.unfinished) return finish(result, active, options, true);
    result.triage = await triageAccount(
      {
        ...deps,
        mailbox: active ? mailbox : null,
        answers: mailbox,
        ...(leave ? { unsubscribe: (accountId: string, messageId: string) => leave(db, accountId, messageId) } : {}),
        sources: { api, mailbox },
        ...(tier ? { model: { judge: tier.judge, model: tier.model } } : {}),
        until,
      },
      account,
    );
    if (result.triage.unfinished || over()) return finish(result, active, options, true);
    result.captured = await captureExamples(db, api, account.id, options.now);
    await keepSuggestionBodies(db, api, account.id, options.now);
    try {
      const filters = await checkFiltersWhenDue(deps, account.id, active);
      if (filters) result.filters = filters;
    } catch (error) {
      // The mail was still triaged; the filters are looked at again next pass.
      options.log(`${account.email}: could not check Gmail filters: ${error instanceof Error ? error.message : String(error)}`);
    }
    return finish(result, active, options, false);
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

function finish(result: PassResult, active: boolean, options: RunOptions, unfinished: boolean): PassResult {
  if (unfinished) result.unfinished = true;
  const line = describe(result, active);
  if (line) options.log(`${result.email}: ${line}`);
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
  if (result.unfinished) parts.push('out of time, carrying on');
  const { filters } = result;
  if (filters?.gone) parts.push(`${filters.gone} filter${filters.gone === 1 ? '' : 's'} deleted in Gmail`);
  if (filters?.changed) parts.push(`${filters.changed} filter${filters.changed === 1 ? '' : 's'} changed in Gmail`);
  if (filters?.outdated)
    parts.push(`${filters.outdated} filter${filters.outdated === 1 ? '' : 's'} ${active ? 'brought into line with' : 'no longer match'} their rules`);
  return parts.length > 0 ? parts.join('; ') : null;
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

/** Send what is due: a pass for every mailbox, each person's upkeep on the first tick of a day, and test runs still going. */
async function tick(store: Store, options: Pick<RunOptions, 'ephemeral' | 'jobs' | 'now'>): Promise<void> {
  const day = Math.floor((options.now ?? Date.now)() / DAY_MS);
  for (const user of await listUsers(store.central)) {
    const db = await store.user(user.id);
    if (await options.ephemeral.claim(`upkeep:${user.id}:${day}`, 2 * DAY_MS)) options.jobs.send({ kind: 'upkeep', person: user.id });
    for (const account of await listAccounts(db)) options.jobs.send({ kind: 'pass', person: user.id, account: account.id });
    // Each is carried on by its own job; this resends one a restart or a lost delivery dropped.
    for (const run of await goingEvals(db)) options.jobs.send({ kind: 'eval', person: user.id, run });
  }
}

/** Tick every interval until `signal` aborts: what a scheduler does on a host. `wait` is for tests. */
export async function runLoop(
  store: Store,
  options: Pick<RunOptions, 'ephemeral' | 'jobs' | 'now'>,
  control: { signal: AbortSignal; wait?: (ms: number) => Promise<void> },
): Promise<void> {
  const wait = control.wait ?? (async (ms: number) => await sleep(ms, undefined, { signal: control.signal }).catch(() => {}));
  while (!control.signal.aborted) {
    await tick(store, options);
    await wait(PASS_INTERVAL_MS);
  }
}
