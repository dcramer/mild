import type { Sql } from '../store/sql.ts';
import { reconcileDue } from '../actions/executor.ts';
import { searchDue } from '../store/kept.ts';
import { addressesDue } from '../store/addresses.ts';
import { draftsDue, scheduledDue } from '../store/drafts.ts';
import { DRAFT_QUIET_MS } from '../actions/drafts.ts';
import { type Account, lastSyncedAt, signInHeld } from '../store/accounts.ts';
import { latestArrival, listUndecided } from '../store/messages.ts';
import { listUnsettledDecisions } from '../store/decisions.ts';
import { preferences } from '../store/preferences.ts';
import { bodiesDue, mailBodiesDue } from './bodies.ts';
import { examplesDue } from './examples.ts';
import { filtersDue } from './filters.ts';
import { type PassStatus, lastPass, recordPassStatus } from './status.ts';
import { TICK_MS, lookGap } from './gap.ts';
import { syncWants } from './sync.ts';
import { endSignIn, isExpiredSignIn } from './pass.ts';
import type { RunOptions } from './run.ts';
import { DAY_MS } from '../time.ts';

/**
 * Whether a pass over this mailbox would do anything: the record first, then, once the mailbox's look gap has passed,
 * Gmail's history since the cursor. Each condition is something a pass (`passMailbox`, ./pass.ts) does, so the two change
 * together. What it cannot tell is a yes. A no is kept as a pass that found nothing would keep it, so "Last checked" stays true.
 */
export async function passWanted(db: Sql, account: Account, options: RunOptions): Promise<boolean> {
  const now = (options.now ?? Date.now)();
  const last = await lastPass(options.ephemeral, account.id);
  try {
    // An expired sign-in fails every pass alike until the person signs in again, which only Gmail answering shows.
    if (!last?.expired && (await recordWants(db, account, options, now, last))) return true;
    // Looked at once the next tick would be past the gap, so a minute's gap is every tick however long the last pass took.
    const arrived = await latestArrival(db, account.id, now);
    if (last && now - last.at <= lookGap(arrived === null ? null : now - arrived) - TICK_MS) return false;
    const { api } = await options.connect(db, account);
    const wanted = await syncWants(db, api, account);
    await signInHeld(db, account.id, now);
    if (last?.expired || wanted) return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Any other error the pass meets too, and reports.
    if (!isExpiredSignIn(message)) return true;
    await endSignIn(db, account, options, now, last?.expired);
    await recordPassStatus(options.ephemeral, account.id, { at: now, error: message, expired: true });
    return false;
  }
  await recordPassStatus(options.ephemeral, account.id, { at: now });
  return false;
}

async function recordWants(db: Sql, account: Account, options: RunOptions, now: number, last: PassStatus | null): Promise<boolean> {
  // Not passed since this ephemeral store began, failed, or out of time: what it left is not all in the record.
  if (!last || last.error || last.unfinished) return true;
  const synced = await lastSyncedAt(db, account.id);
  // The day's first sync reads the mailbox's other addresses again.
  if (synced === null || Math.floor(synced / DAY_MS) !== Math.floor(now / DAY_MS)) return true;
  const { active } = await preferences(db);
  if (active && (await reconcileDue(db, account.id))) return true;
  if ((await listUnsettledDecisions(db, account.id, active ? {} : { byUserOnly: true })).length > 0) return true;
  if (await bodiesDue(db, account.id, now)) return true;
  if (await mailBodiesDue(db, account.id)) return true;
  if (await searchDue(db, account.id)) return true;
  if (await addressesDue(db, account.id)) return true;
  if (await draftsDue(db, account.id, now - DRAFT_QUIET_MS)) return true;
  if (await scheduledDue(db, account.id, now)) return true;
  if (await examplesDue(db, account.id)) return true;
  if (await filtersDue(db, account.id, active, now)) return true;
  // With no model, what no rule covers waits for one and a pass leaves it be. A rule added since decides it at the next
  // pass begun for anything else: new mail, a press, the day's first sync.
  return (await listUndecided(db, account.id, 1)).length > 0 && Boolean(options.model && (await options.model(db)));
}
