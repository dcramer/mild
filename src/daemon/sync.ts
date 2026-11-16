import type { Sql } from '../store/sql.ts';
import type { GmailApi } from '../gmail/api.ts';
import { type PullResult, pullChanges, toFacts } from '../gmail/sync.ts';
import { learnFromGmail, userChanges } from '../learn/gmail.ts';
import { type Account, lastSyncedAt, recordSync } from '../store/accounts.ts';
import type { MessageFacts } from '../triage/types.ts';

export interface SyncReport {
  mode: PullResult['mode'];
  /** Messages recorded for the first time, oldest first. */
  added: MessageFacts[];
  /** Arrivals that had already left the inbox, been deleted, or had no usable sender. */
  skipped: number;
  /** Answers read from what the user did to messages in Gmail. */
  corrections: number;
}

/**
 * Pull one account's new inbox mail into the store. Nothing is persisted until every message has
 * been fetched, so a failure part-way leaves the cursor where it was and the next run retries.
 */
export async function syncAccount(db: Sql, api: GmailApi, account: Account, now: () => number = Date.now): Promise<SyncReport> {
  // Recorded as the sync time, so the next sync knows which of sift's own changes its history can contain: those made since this one began.
  const startedAt = now();
  const pull = await pullChanges(api, account.historyId);
  const byUser = await userChanges(db, account.id, pull.labelChanges, (await lastSyncedAt(db, account.id)) ?? 0);
  const fetched: MessageFacts[] = [];
  let skipped = 0;

  for (const id of pull.messageIds) {
    const raw = await api.getMetadata(id);
    const facts = raw?.labelIds.includes('INBOX') ? toFacts(account.id, raw) : null;
    if (facts) fetched.push(facts);
    else skipped++;
  }

  const known = new Set((await db.all<{ id: string }>('SELECT id FROM messages WHERE account_id = ?', account.id)).map((r) => r.id));
  const added = fetched.filter((m) => !known.has(m.messageId));
  // Before the cursor moves: a failure here means the same history is read again, which this tolerates.
  const corrections = await learnFromGmail(db, account.id, byUser, api, startedAt);
  const read = byUser.filter((c) => c.removed.includes('UNREAD')).map((c) => c.messageId);
  await recordSync(db, account.id, fetched, pull.historyId, startedAt, read);
  return { mode: pull.mode, added, skipped, corrections };
}
