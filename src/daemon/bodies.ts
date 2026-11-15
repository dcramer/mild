import type { DatabaseSync } from 'node:sqlite';
import type { GmailApi } from '../gmail/api.ts';
import { pendingSuggestions } from '../learn/feedback.ts';

const PER_PASS = 50;
export const KEEP_BODY_DAYS = 30;

/**
 * Keep the text of mail waiting on the user, and only that. Fetches it for suggestions that would move
 * the mail or that sift could not place (mail it would simply keep is not fetched), and drops the text
 * of anything answered, no longer a suggestion, or older than `KEEP_BODY_DAYS`. A failed fetch is tried
 * again on the next pass. Returns how many were fetched.
 */
export async function keepSuggestionBodies(
  db: DatabaseSync,
  api: Pick<GmailApi, 'getBodyText'>,
  accountId: string,
  now: () => number = Date.now,
): Promise<number> {
  const cutoff = now() - KEEP_BODY_DAYS * 86_400_000;
  const waiting = pendingSuggestions(db, { accountId }).filter((s) => s.disposition !== 'keep' && s.decidedAt >= cutoff);
  const wanted = new Set(waiting.map((s) => s.messageId));

  const stored = db.prepare('SELECT message_id, fetched_at FROM suggestion_bodies WHERE account_id = ?').all(accountId) as {
    message_id: string;
    fetched_at: number;
  }[];
  const drop = db.prepare('DELETE FROM suggestion_bodies WHERE account_id = ? AND message_id = ?');
  const have = new Set<string>();
  for (const row of stored) {
    if (wanted.has(row.message_id) && row.fetched_at >= cutoff) have.add(row.message_id);
    else drop.run(accountId, row.message_id);
  }

  const insert = db.prepare('INSERT OR REPLACE INTO suggestion_bodies (account_id, message_id, body_text, fetched_at) VALUES (?, ?, ?, ?)');
  let fetched = 0;
  for (const suggestion of waiting) {
    if (fetched >= PER_PASS) break;
    if (have.has(suggestion.messageId)) continue;
    // A message that has gone is stored empty, so it is not asked for again on every pass.
    insert.run(accountId, suggestion.messageId, (await api.getBodyText(suggestion.messageId)) ?? '', now());
    fetched++;
  }
  return fetched;
}
