import type { DatabaseSync } from 'node:sqlite';
import type { GmailApi } from '../gmail/api.ts';
import { toFacts } from '../gmail/sync.ts';
import { recordBackfill } from '../store/accounts.ts';
import type { MessageFacts } from '../triage/types.ts';

/** Enough to teach with, and a bound on what one click can spend on model calls. */
export const MAX_BACKFILL = 300;

/**
 * Pull the inbox's last `days` days into sift so there is something to teach with before new mail
 * arrives. The messages are marked suggest-only: the next pass decides them, and nothing is ever done to
 * them in Gmail. Returns how many were new to sift.
 */
export async function backfill(
  db: DatabaseSync,
  api: Pick<GmailApi, 'searchInbox' | 'getMetadata'>,
  accountId: string,
  days: number,
  now: number = Date.now(),
): Promise<number> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api.searchInbox(`newer_than:${days}d`, pageToken);
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_BACKFILL);

  const messages: MessageFacts[] = [];
  for (const id of ids.slice(0, MAX_BACKFILL)) {
    const raw = await api.getMetadata(id);
    const facts = raw ? toFacts(accountId, raw) : null;
    if (facts) messages.push(facts);
  }
  return recordBackfill(db, accountId, messages, now);
}
