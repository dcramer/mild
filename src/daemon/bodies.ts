import type { Sql } from '../store/sql.ts';
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
export async function keepSuggestionBodies(db: Sql, api: Pick<GmailApi, 'getBodyText'>, accountId: string, now: () => number = Date.now): Promise<number> {
  const cutoff = now() - KEEP_BODY_DAYS * 86_400_000;
  const waiting = (await pendingSuggestions(db, { accountId })).filter((s) => s.disposition !== 'keep' && s.decidedAt >= cutoff);
  const wanted = new Set(waiting.map((s) => s.messageId));

  const stored = await db.all<{
    message_id: string;
    fetched_at: number;
  }>('SELECT message_id, fetched_at FROM suggestion_bodies WHERE account_id = ?', accountId);
  const have = new Set<string>();
  for (const row of stored) {
    if (wanted.has(row.message_id) && row.fetched_at >= cutoff) have.add(row.message_id);
    else await db.run('DELETE FROM suggestion_bodies WHERE account_id = ? AND message_id = ?', accountId, row.message_id);
  }

  let fetched = 0;
  for (const suggestion of waiting) {
    if (fetched >= PER_PASS) break;
    if (have.has(suggestion.messageId)) continue;
    // A message that has gone is stored empty, so it is not asked for again on every pass.
    const text = (await api.getBodyText(suggestion.messageId)) ?? '';
    await db.run(
      `INSERT INTO suggestion_bodies (account_id, message_id, body_text, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (account_id, message_id) DO UPDATE SET body_text = excluded.body_text, fetched_at = excluded.fetched_at`,
      accountId,
      suggestion.messageId,
      text,
      now(),
    );
    fetched++;
  }
  return fetched;
}
