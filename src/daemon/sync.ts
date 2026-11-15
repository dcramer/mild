import type { DatabaseSync } from 'node:sqlite';
import type { GmailApi } from '../gmail/api.ts';
import { type PullResult, pullChanges, toFacts } from '../gmail/sync.ts';
import { type Account, recordSync } from '../store/accounts.ts';
import type { MessageFacts } from '../triage/types.ts';

export interface SyncReport {
  mode: PullResult['mode'];
  /** Messages recorded for the first time, oldest first. */
  added: MessageFacts[];
  /** Arrivals that had already left the inbox, been deleted, or had no usable sender. */
  skipped: number;
}

/**
 * Pull one account's new inbox mail into the store. Nothing is persisted until every message has
 * been fetched, so a failure part-way leaves the cursor where it was and the next run retries.
 */
export async function syncAccount(db: DatabaseSync, api: GmailApi, account: Account): Promise<SyncReport> {
  const pull = await pullChanges(api, account.historyId);
  const fetched: MessageFacts[] = [];
  let skipped = 0;

  for (const id of pull.messageIds) {
    const raw = await api.getMetadata(id);
    const facts = raw?.labelIds.includes('INBOX') ? toFacts(account.id, raw) : null;
    if (facts) fetched.push(facts);
    else skipped++;
  }

  const known = new Set((db.prepare('SELECT id FROM messages WHERE account_id = ?').all(account.id) as { id: string }[]).map((r) => r.id));
  const added = fetched.filter((m) => !known.has(m.messageId));
  recordSync(db, account.id, fetched, pull.historyId);
  return { mode: pull.mode, added, skipped };
}
