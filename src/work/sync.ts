import { and, eq, inArray, messages } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import type { GmailApi } from '../gmail/api.ts';
import { type PullResult, pullChanges, toFacts } from '../gmail/sync.ts';
import { learnFromGmail, userChanges } from '../learn/gmail.ts';
import { type Account, lastSyncedAt, recordSync, recordSynced, setMailboxAliases } from '../store/accounts.ts';
import { isOwnDigest, knownDigests } from '../store/digests.ts';
import type { MessageFacts } from '../triage/types.ts';

const DAY_MS = 86_400_000;
/**
 * Fetched messages are recorded this many at a time, so a sync cut short keeps what it fetched and the
 * next fetches only the rest. 50 metadata reads are 1,000 quota units.
 */
const CHUNK = 50;
/**
 * How long before the last sync began a message history did not list as added may say it arrived and still be
 * taken as new: Gmail's arrival time and its history are not in step. Older mail put back in the inbox is not new.
 */
const LATE = 60 * 60_000;

export interface SyncReport {
  mode: PullResult['mode'];
  /** Messages recorded for the first time, oldest first. */
  added: MessageFacts[];
  /** Arrivals that had already left the inbox, been deleted, had no usable sender, or were Sift's own digests. */
  skipped: number;
  /** Answers read from what the user did to messages in Gmail. */
  corrections: number;
  /** Stopped at `until`: what was fetched is recorded, the cursor has not moved, and the next sync fetches the rest. */
  unfinished?: true;
}

/**
 * Pull one account's new inbox mail into the store. The cursor moves only once every message has been
 * fetched, so a failure part-way leaves it where it was and the next run reads the same history again.
 */
export async function syncAccount(db: Sql, api: GmailApi, account: Account, now: () => number = Date.now, until = Infinity): Promise<SyncReport> {
  // Recorded as the sync time, so the next sync knows which of sift's own changes its history can contain: those made since this one began.
  const startedAt = now();
  const syncedAt = await lastSyncedAt(db, account.id);
  // On the first sync of a day, before this sync's mail is recorded with them.
  if (syncedAt === null || Math.floor(syncedAt / DAY_MS) !== Math.floor(startedAt / DAY_MS)) {
    try {
      await setMailboxAliases(db, account.id, await api.listSendAs());
    } catch {
      // The last list stands until tomorrow's.
    }
  }
  const pull = await mailOnly(db, account, await pullChanges(api, account.historyId));
  const byUser = await userChanges(db, account.id, pull.labelChanges, syncedAt ?? 0);
  const known = await recorded(db, account.id, [...pull.messageIds, ...pull.strays]);
  const since = (syncedAt ?? startedAt) - LATE;
  const added: MessageFacts[] = [];
  let unrecorded: MessageFacts[] = [];
  let skipped = 0;

  for (const [id, stray] of [...pull.messageIds.map((id) => [id, false] as const), ...pull.strays.map((id) => [id, true] as const)]) {
    if (known.has(id)) continue;
    if (now() >= until) {
      await recordSynced(db, account.id, unrecorded, startedAt);
      return { mode: pull.mode, added, skipped, corrections: 0, unfinished: true };
    }
    const raw = await api.getMetadata(id);
    const arrived = raw?.labelIds.includes('INBOX') && (!stray || raw.internalDate >= since);
    const facts = raw && arrived ? toFacts(account.id, raw) : null;
    // A digest whose Gmail id Sift had not recorded yet when this read it.
    if (!facts || (await isOwnDigest(db, facts.headers))) {
      if (!stray) skipped++;
      continue;
    }
    added.push(facts);
    unrecorded.push(facts);
    if (unrecorded.length === CHUNK) {
      await recordSynced(db, account.id, unrecorded, startedAt);
      unrecorded = [];
    }
  }

  // Before the cursor moves: a failure here means the same history is read again, which this tolerates.
  const corrections = await learnFromGmail(db, account.id, byUser, api, startedAt);
  const read = byUser.filter((c) => c.removed.includes('UNREAD')).map((c) => c.messageId);
  await recordSync(db, account.id, unrecorded, pull.historyId, startedAt, read);
  return { mode: pull.mode, added, skipped, corrections };
}

/**
 * Whether `syncAccount` would find anything: mail new to the inbox, or a change the person made in Gmail. Sift's own
 * changes move Gmail's history too, and are told from the person's as sync tells them, so they begin no pass. Reads
 * history from the cursor (2 quota units a page) and moves nothing.
 */
export async function syncWants(db: Sql, api: GmailApi, account: Account): Promise<boolean> {
  const pull = await mailOnly(db, account, await pullChanges(api, account.historyId));
  if (pull.mode !== 'incremental' || pull.messageIds.length > 0) return true;
  if ((await recorded(db, account.id, pull.strays)).size < pull.strays.length) return true;
  return (await userChanges(db, account.id, pull.labelChanges, (await lastSyncedAt(db, account.id)) ?? 0)).length > 0;
}

/** Which of `ids` the record already holds. */
async function recorded(db: Sql, accountId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), inArray(messages.id, [...ids])));
  return new Set(rows.map((r) => r.id));
}

/** History without Sift's own digests: one arriving, or read, is nothing for a pass to do. */
async function mailOnly(db: Sql, account: Account, pull: PullResult): Promise<PullResult> {
  const digests = await knownDigests(db, account.id, [...new Set([...pull.messageIds, ...pull.strays, ...pull.labelChanges.map((c) => c.messageId)])]);
  if (digests.size === 0) return pull;
  return {
    ...pull,
    messageIds: pull.messageIds.filter((id) => !digests.has(id)),
    strays: pull.strays.filter((id) => !digests.has(id)),
    labelChanges: pull.labelChanges.filter((c) => !digests.has(c.messageId)),
  };
}
