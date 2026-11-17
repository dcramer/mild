import type { Sql } from '../store/sql.ts';
import { reconcile } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import type { MessageContent } from '../gmail/body.ts';
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
/**
 * How long a piece of work holds its lock past its own time limit: a model call under way may run a
 * minute over. A host that cuts the work off leaves the lock to run out about when the next tick wants it.
 */
const HOLD_PAST_LIMIT_MS = 60_000;
/** The longest a lock is held, for work with no limit (`sift run --once`, tests). */
const LONGEST_HOLD_MS = 15 * 60_000;
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
    const result = await unlessUnderWay(options, `lock:pass:${account.id}`, Infinity, () => passMailbox(db, account, options, Infinity));
    if (result) results.push(result);
  }
  return results;
}

/** A piece of work a tick found due. */
/**
 * A piece of work a tick found due: ids only, so it can be handed to a call of its own (Vercel), and
 * whatever runs it opens everything it touches from them.
 */
export type Work =
  | { kind: 'pass'; person: number; account: string }
  | { kind: 'upkeep'; person: number }
  | { kind: 'backfill'; person: number; account: string; days: number }
  | { kind: 'eval'; person: number; run: number };

/**
 * What is due, for these people or everyone: found in the record and the ephemeral store, so a tick needs
 * nothing remembered from the last, and work a tick left unfinished is simply due again.
 */
export async function dueWork(store: Store, options: RunOptions, people?: readonly number[]): Promise<Work[]> {
  const day = Math.floor((options.now ?? Date.now)() / DAY_MS);
  const due: Work[] = [];
  for (const { id: person } of await listUsers(store.central)) {
    if (people && !people.includes(person)) continue;
    const db = await store.user(person);
    if (await options.ephemeral.claim(`upkeep:${person}:${day}`, 2 * DAY_MS)) due.push({ kind: 'upkeep', person });
    for (const account of await listAccounts(db)) {
      due.push({ kind: 'pass', person, account: account.id });
      const days = await options.ephemeral.get<number>(backfillKey(account.id));
      if (days !== null) due.push({ kind: 'backfill', person, account: account.id, days });
    }
    for (const run of await goingEvals(db)) due.push({ kind: 'eval', person, run });
  }
  return due;
}

/**
 * Do what is due here, `AT_ONCE` at a time, each piece starting nothing after `limitMs` from its own start,
 * as it would in a call of its own. Ticks may overlap; each piece holds a lock, so one under way is skipped.
 */
export async function tick(store: Store, options: RunOptions, limitMs: number, people?: readonly number[]): Promise<PassResult[]> {
  const due = await dueWork(store, options, people);
  const results: PassResult[] = [];
  const now = options.now ?? Date.now;
  const worker = async () => {
    for (let work = due.shift(); work; work = due.shift()) {
      const result = await runWork(store, work, options, now() + limitMs);
      if (result) results.push(result);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return results;
}

const describeWork = (work: Work) =>
  work.kind === 'pass'
    ? `${work.account}: pass`
    : work.kind === 'backfill'
      ? `${work.account}: pulling in older mail`
      : work.kind === 'eval'
        ? 'A test run'
        : 'Deleting old records';

/** Ask for the last `days` days of a mailbox's inbox to be pulled in, by the ticks that follow. */
export async function askForBackfill(ephemeral: Ephemeral, account: string, days: number): Promise<void> {
  await ephemeral.set(backfillKey(account), days, BACKFILL_MS);
}

/** Run `work` unless something else is doing it now, holding it until a little past `until`. Null when it was. */
async function unlessUnderWay<T>(options: RunOptions, lock: string, until: number, work: () => Promise<T>): Promise<T | null> {
  const ms = Math.min(until - (options.now ?? Date.now)(), LONGEST_HOLD_MS) + HOLD_PAST_LIMIT_MS;
  const token = await options.ephemeral.claim(lock, ms);
  if (token === null) return null;
  try {
    return await work();
  } finally {
    await options.ephemeral.release(lock, token);
  }
}

/**
 * Run one piece of due work, starting nothing after `until`. Everything it touches is opened here from the
 * piece's ids. A failure is logged; the piece is due again at the next tick.
 */
export async function runWork(store: Store, work: Work, options: RunOptions, until: number): Promise<PassResult | null> {
  try {
    if (!(await stillThere(store, work.person))) return null;
    const db = await store.user(work.person);
    const account = 'account' in work ? (await listAccounts(db)).find((a) => a.id === work.account) : undefined;
    switch (work.kind) {
      case 'upkeep':
        await upkeep(db, options);
        return null;
      case 'pass':
        return account ? await unlessUnderWay(options, `lock:pass:${account.id}`, until, () => passMailbox(db, account, options, until)) : null;
      case 'backfill':
        if (account)
          await unlessUnderWay(options, `lock:backfill:${account.id}`, until, async () => {
            const { api } = await options.connect(db, account);
            if (await backfill(db, api, account.id, work.days, until, options.now)) await options.ephemeral.take(backfillKey(account.id));
          });
        return null;
      case 'eval':
        await unlessUnderWay(options, `lock:eval:${work.person}:${work.run}`, until, async () => {
          const tier = options.model ? await options.model(db) : null;
          if (tier) await continueEval({ db, judge: tier.judge, model: tier.model, ...(options.now ? { now: options.now } : {}) }, work.run, until);
        });
        return null;
    }
  } catch (error) {
    // A person deleted meanwhile has nothing left to report.
    if (await stillThere(store, work.person))
      options.log(`${describeWork(work)} failed, will retry: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Gmail for one pass, reading each message whole at most once: the model, the examples and the bodies kept
 * for waiting mail share the read. `held` says which were read; a read that failed is asked for again. Held only for the pass.
 */
function readingOnce(api: GmailApi): { api: GmailApi; held: (messageId: string) => boolean } {
  const reads = new Map<string, Promise<MessageContent | null>>();
  const done = new Set<string>();
  const getContent = (messageId: string) => {
    let read = reads.get(messageId);
    if (!read) {
      read = api.getContent(messageId);
      reads.set(messageId, read);
      read.then(
        () => done.add(messageId),
        () => reads.delete(messageId),
      );
    }
    return read;
  };
  return { api: { ...api, getContent }, held: (messageId) => done.has(messageId) };
}

/** One pass, its outcome kept for the dashboard. Null when the mailbox was removed while it ran. */
async function passMailbox(db: Sql, account: Account, options: RunOptions, until: number): Promise<PassResult | null> {
  const result = await runMailbox(db, account, options, until);
  if (result)
    await recordPassStatus(options.ephemeral, account.id, {
      at: (options.now ?? Date.now)(),
      ...(result.error ? { error: result.error } : {}),
      ...(result.expired ? { expired: true } : {}),
    });
  return result;
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
    const { api: gmail, mailbox } = await options.connect(db, account);
    const { api, held } = readingOnce(gmail);
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
    const out = Boolean(result.triage.unfinished) || over();
    // Out of time, the text the model read is still kept for the mail it left waiting, and nothing more is fetched.
    await keepSuggestionBodies(db, api, account.id, options.now, { held, fetch: !out });
    if (out) return finish(result, active, options, true);
    result.captured = await captureExamples(db, api, account.id, options.now);
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
