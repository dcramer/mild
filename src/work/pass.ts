import type { Sql } from '../store/sql.ts';
import { reconcile } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import { indexKept } from '../store/kept.ts';
import { fillAddresses } from '../store/addresses.ts';
import { sendScheduled } from './drafts.ts';
import { pushDrafts } from '../actions/drafts.ts';
import type { FilterCheck } from '../actions/rule-filters.ts';
import { type Account, listAccounts, signInEnded } from '../store/accounts.ts';
import { preferences } from '../store/preferences.ts';
import { keepMailBodies, keepWaitingText, readingOnce } from './bodies.ts';
import { captureExamples } from './examples.ts';
import { checkFiltersWhenDue } from './filters.ts';
import { recordPassStatus } from './status.ts';
import { type SyncReport, syncAccount } from './sync.ts';
import { CHANGE_TRIES, type TriageReport, triageAccount } from './triage.ts';
import { reportError } from '../telemetry.ts';
import type { RunOptions } from './run.ts';

export interface PassResult {
  email: string;
  sync?: SyncReport;
  triage?: TriageReport;
  /** Marked messages whose full content was stored this pass. */
  captured?: number;
  /** Kept messages given a search index this pass. */
  indexed?: number;
  /** What a look at the account's Gmail filters found, on the passes that looked. */
  filters?: FilterCheck;
  error?: string;
  /** The error is Google refusing Mild's sign-in for this account. Retrying will not help; signing in again will. */
  expired?: true;
  /** Stopped at its time limit with work left. */
  unfinished?: true;
}

/**
 * Kept text with no search index, indexed by each pass: about 3 seconds of a pass, so 100,000 messages take 100 passes,
 * which the look begins one a minute while any is left (`searchDue`).
 */
const INDEX_PER_PASS = 1_000;

/** Recorded mail added to the address book by each pass, while it is being filled: headers only, so several times as many as are indexed. */
const ADDRESSES_PER_PASS = 5_000;

/** Google's answer when a refresh token is no longer good; an app left in Testing does this every 7 days. */
export const isExpiredSignIn = (message: string) => message.includes('invalid_grant');

/** Mark the mailbox's sign-in ended, and say so unless it was already known to have. */
export async function endSignIn(db: Sql, account: Account, options: Pick<RunOptions, 'log'>, now: number, known = false): Promise<void> {
  await signInEnded(db, account.id, now);
  if (!known) options.log(`${account.email}: Google sign-in has expired. Sign in to the dashboard again.`);
}

/** What deciding mail needs, for a pass and for going through the inbox alike: Gmail is changed only while Mild is on. */
export function deciding(db: Sql, options: RunOptions, gmail: { api: GmailApi; mailbox: Mailbox }, active: boolean, until: number) {
  const leave = options.unsubscribe;
  const { api, mailbox } = gmail;
  return {
    db,
    mailbox: active ? mailbox : null,
    answers: mailbox,
    ...(leave ? { unsubscribe: (accountId: string, messageId: string) => leave(db, accountId, messageId) } : {}),
    sources: { api, mailbox },
    until,
    now: options.now ?? Date.now,
  };
}

/** One pass, its outcome kept for the dashboard. Null when the mailbox was removed while it ran. */
export async function passMailbox(db: Sql, account: Account, options: RunOptions, until: number): Promise<PassResult | null> {
  const began = (options.now ?? Date.now)();
  const result = await runMailbox(db, account, options, until);
  if (result)
    await recordPassStatus(options.ephemeral, account.id, {
      at: began,
      ...(result.error ? { error: result.error } : {}),
      ...(result.expired ? { expired: true } : {}),
      ...(result.unfinished ? { unfinished: true } : {}),
    });
  return result;
}

/**
 * One pass over one mailbox, changing Gmail only if its person has Mild on: settle unconfirmed actions,
 * sync, triage. A failure is reported; the next pass picks up where this one stopped.
 */
async function runMailbox(db: Sql, account: Account, options: RunOptions, until: number): Promise<PassResult | null> {
  const now = options.now ?? Date.now;
  const over = () => now() >= until;
  const { active } = await preferences(db);
  const tier = options.model ? await options.model(db) : null;
  const result: PassResult = { email: account.email };
  try {
    const { api: gmail, mailbox } = await options.connect(db, account);
    // Every read of a message's text in the pass goes through this, so each is read from Gmail once and kept.
    const api = { ...gmail, ...readingOnce(db, account.id, gmail, now) };
    if (active) await reconcile({ db, mailbox, now }, { accountId: account.id });
    // The person's own press, timed: before anything a backlog could hold it behind, and whether Mild is on or not.
    await sendScheduled(db, { api: gmail, mailbox }, account.id, now());
    result.sync = await syncAccount(db, api, account, now, until);
    if (result.sync.unfinished) return finish(result, active, options, true);
    // Before triage, which takes every pass there is while a backlog lasts: read only after it, mail left waiting would never get its text.
    if (!over()) await keepWaitingText(db, api, account.id, now);
    result.triage = await triageAccount(
      { ...deciding(db, options, { api, mailbox }, active, until), ...(tier ? { model: { judge: tier.judge, model: tier.model } } : {}) },
      account,
    );
    if (result.triage.unfinished || over()) return finish(result, active, options, true);
    await keepWaitingText(db, api, account.id, now);
    // After triage, unlike waiting mail's: Inbox shows mail as it is, so classifying comes first.
    await keepMailBodies(db, api, account.id, now);
    if (over()) return finish(result, active, options, true);
    result.indexed = await indexKept(db, account.id, INDEX_PER_PASS, over);
    if (over()) return finish(result, active, options, true);
    await fillAddresses(db, account.id, ADDRESSES_PER_PASS, over);
    // The person's own, so whether Mild is on or not.
    await pushDrafts(db, mailbox, account.id, now());
    if (over()) return finish(result, active, options, true);
    result.captured = await captureExamples(db, api, account.id);
    try {
      const filters = await checkFiltersWhenDue({ db, mailbox, now }, account.id, active);
      if (filters) result.filters = filters;
    } catch (error) {
      // The mail was still triaged; the filters are looked at again next pass.
      reportError(error);
      options.log(`${account.email}: could not check Gmail filters: ${error instanceof Error ? error.message : String(error)}`);
    }
    return finish(result, active, options, false);
  } catch (error) {
    // Removed while the pass ran: there is nothing left to report about.
    if (!(await listAccounts(db)).some((a) => a.id === account.id)) return null;
    result.error = error instanceof Error ? error.message : String(error);
    if (isExpiredSignIn(result.error)) {
      result.expired = true;
      await endSignIn(db, account, options, now());
    } else {
      reportError(error);
      options.log(`${account.email}: pass failed, will retry: ${result.error}`);
    }
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
  if (sync?.kept) parts.push(`${sync.kept} more kept for Inbox`);
  if (sync?.corrections) parts.push(`learned from ${sync.corrections} message${sync.corrections === 1 ? '' : 's'} you moved or relabelled in Gmail`);
  if (triage) {
    const decided = Object.entries(triage.decided).filter(([, n]) => n > 0);
    if (decided.length > 0) parts.push(`${active ? 'decided' : 'would'} ${decided.map(([d, n]) => `${d} ${n}`).join(', ')}`);
    if (triage.acted > 0) parts.push(`${triage.acted} changed`);
    if (triage.skipped > 0) parts.push(`${triage.skipped} skipped`);
    if (triage.unsubscribed > 0) parts.push(`unsubscribed from ${triage.unsubscribed} sender${triage.unsubscribed === 1 ? '' : 's'}`);
    if (triage.blocked > 0) parts.push(`blocked ${triage.blocked} sender${triage.blocked === 1 ? '' : 's'}`);
    if (triage.unjudged > 0) parts.push(`the model failed on ${triage.unjudged}: ${triage.failure}`);
    if (triage.retrying > 0) parts.push(`${triage.retrying} change${triage.retrying === 1 ? '' : 's'} to try again`);
    if (triage.troubled > 0) parts.push(`${triage.troubled} change${triage.troubled === 1 ? '' : 's'} not made after ${CHANGE_TRIES} tries`);
  }
  if (result.indexed) parts.push(`indexed ${result.indexed} kept message${result.indexed === 1 ? '' : 's'} for search`);
  if (result.captured) parts.push(`stored ${result.captured} marked message${result.captured === 1 ? '' : 's'} as examples`);
  if (result.unfinished) parts.push('out of time, carrying on');
  const { filters } = result;
  if (filters?.gone) parts.push(`${filters.gone} filter${filters.gone === 1 ? '' : 's'} deleted in Gmail`);
  if (filters?.changed) parts.push(`${filters.changed} filter${filters.changed === 1 ? '' : 's'} changed in Gmail`);
  if (filters?.outdated)
    parts.push(`${filters.outdated} filter${filters.outdated === 1 ? '' : 's'} ${active ? 'brought into line with' : 'no longer match'} their rules`);
  return parts.length > 0 ? parts.join('; ') : null;
}
