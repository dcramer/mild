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
/** How long a pass holds its mailbox: longer than a pass should take, and how long one that dies keeps it. */
const PASS_HOLD_MS = 15 * 60_000;
/** The same for a slice of a test run, or of pulling in older mail. */
const WORK_HOLD_MS = 15 * 60_000;
/**
 * How many pieces of work one tick does at once: enough that one mailbox's backlog (a minute-long model
 * call, a sync waiting on Gmail's quota) does not hold up everyone's new mail.
 */
const AT_ONCE = 4;
/** Older mail asked for and not yet all pulled in, by mailbox; given up after a day. */
const backfillKey = (account: string) => `backfill:${account}`;
const BACKFILL_MS = 86_400_000;

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

/** One pass over each mailbox in one person's database, one after another. A mailbox another pass holds is left out. */
export async function runOnce(db: Sql, options: RunOptions): Promise<PassResult[]> {
  const results: PassResult[] = [];
  for (const account of await listAccounts(db)) {
    const result = await passMailbox(db, account, options, Infinity);
    if (result) results.push(result);
  }
  return results;
}

/** A piece of work a tick found due. */
type Work =
  | { kind: 'pass'; person: number; account: Account }
  | { kind: 'upkeep'; person: number }
  | { kind: 'backfill'; person: number; account: Account; days: number }
  | { kind: 'eval'; person: number; run: number };

/**
 * What is due, for these people or everyone: found in the record and the ephemeral store, so a tick needs
 * nothing remembered from the last, and work a tick left unfinished is simply due again.
 */
async function dueWork(store: Store, options: RunOptions, people?: readonly number[]): Promise<Work[]> {
  const day = Math.floor((options.now ?? Date.now)() / DAY_MS);
  const due: Work[] = [];
  for (const { id: person } of await listUsers(store.central)) {
    if (people && !people.includes(person)) continue;
    const db = await store.user(person);
    if (await options.ephemeral.claim(`upkeep:${person}:${day}`, 2 * DAY_MS)) due.push({ kind: 'upkeep', person });
    for (const account of await listAccounts(db)) {
      due.push({ kind: 'pass', person, account });
      const days = await options.ephemeral.get<number>(backfillKey(account.id));
      if (days !== null) due.push({ kind: 'backfill', person, account, days });
    }
    for (const run of await goingEvals(db)) due.push({ kind: 'eval', person, run });
  }
  return due;
}

/**
 * Do what is due, `AT_ONCE` at a time, starting nothing after `until`: a host's function has a time limit,
 * and `sift run` sets one too so the same path runs everywhere. Ticks may overlap; each piece of work holds
 * a lock, so one already under way is skipped.
 */
export async function tick(store: Store, options: RunOptions, until: number, people?: readonly number[]): Promise<PassResult[]> {
  const due = await dueWork(store, options, people);
  const results: PassResult[] = [];
  const now = options.now ?? Date.now;
  const worker = async () => {
    for (let work = due.shift(); work && now() < until; work = due.shift()) {
      try {
        const result = await runWork(store, work, options, until);
        if (result) results.push(result);
      } catch (error) {
        // A person deleted meanwhile has nothing left to report.
        if (await stillThere(store, work.person))
          options.log(`${describeWork(work)} failed, will retry: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return results;
}

const describeWork = (work: Work) =>
  work.kind === 'pass'
    ? `${work.account.email}: pass`
    : work.kind === 'backfill'
      ? `${work.account.email}: pulling in older mail`
      : work.kind === 'eval'
        ? 'A test run'
        : 'Deleting old records';

/** Ask for the last `days` days of a mailbox's inbox to be pulled in, by the ticks that follow. */
export async function askForBackfill(ephemeral: Ephemeral, account: string, days: number): Promise<void> {
  await ephemeral.set(backfillKey(account), days, BACKFILL_MS);
}

/** Run `work` unless another tick is doing it now. */
async function unlessUnderWay(ephemeral: Ephemeral, lock: string, work: () => Promise<void>): Promise<void> {
  const token = await ephemeral.claim(lock, WORK_HOLD_MS);
  if (token === null) return;
  try {
    await work();
  } finally {
    await ephemeral.release(lock, token);
  }
}

async function runWork(store: Store, work: Work, options: RunOptions, until: number): Promise<PassResult | null> {
  if (!(await stillThere(store, work.person))) return null;
  const db = await store.user(work.person);
  switch (work.kind) {
    case 'upkeep':
      await upkeep(db, options);
      return null;
    case 'pass':
      return await passMailbox(db, work.account, options, until);
    case 'backfill':
      await unlessUnderWay(options.ephemeral, `lock:backfill:${work.account.id}`, async () => {
        const { api } = await options.connect(db, work.account);
        if (await backfill(db, api, work.account.id, work.days, until, options.now)) await options.ephemeral.take(backfillKey(work.account.id));
      });
      return null;
    case 'eval':
      await unlessUnderWay(options.ephemeral, `lock:eval:${work.person}:${work.run}`, async () => {
        const tier = options.model ? await options.model(db) : null;
        if (tier) await continueEval({ db, judge: tier.judge, model: tier.model, ...(options.now ? { now: options.now } : {}) }, work.run, until);
      });
      return null;
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
