import { and, eq, suggestionBodies } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import type { GmailApi } from '../gmail/api.ts';
import { pendingSuggestions } from '../learn/feedback.ts';
import { sealPart } from '../store/content.ts';

const PER_PASS = 50;
export const KEEP_BODY_DAYS = 30;

/**
 * Keep the text and HTML of mail waiting on the user, and only that. Fetches it for suggestions that would move
 * the mail or that sift could not place (mail it would simply keep is not fetched), and drops the text
 * of anything answered, no longer a suggestion, or older than `KEEP_BODY_DAYS`. A failed fetch is tried
 * again on the next pass. Returns how many were fetched.
 *
 * `held`: messages this pass has already read, kept whatever `PER_PASS` says, and even when `fetch` is
 * false (out of time), so Gmail is not asked for them again.
 */
export async function keepSuggestionBodies(
  db: Sql,
  api: Pick<GmailApi, 'getContent'>,
  accountId: string,
  now: () => number = Date.now,
  { held = () => false, fetch = true }: { held?: (messageId: string) => boolean; fetch?: boolean } = {},
): Promise<number> {
  const cutoff = now() - KEEP_BODY_DAYS * 86_400_000;
  const waiting = (await pendingSuggestions(db, { accountId })).filter((s) => s.disposition !== 'keep' && s.decidedAt >= cutoff);
  const wanted = new Set(waiting.map((s) => s.messageId));

  const stored = await db
    .select({ messageId: suggestionBodies.messageId, fetchedAt: suggestionBodies.fetchedAt })
    .from(suggestionBodies)
    .where(eq(suggestionBodies.accountId, accountId));
  const have = new Set<string>();
  for (const row of stored) {
    if (wanted.has(row.messageId) && row.fetchedAt >= cutoff) have.add(row.messageId);
    else await db.delete(suggestionBodies).where(and(eq(suggestionBodies.accountId, accountId), eq(suggestionBodies.messageId, row.messageId)));
  }

  let fetched = 0;
  for (const suggestion of waiting) {
    if (have.has(suggestion.messageId)) continue;
    const inHand = held(suggestion.messageId);
    if (!inHand && (!fetch || fetched >= PER_PASS)) continue;
    // A message that has gone is stored empty, so it is not asked for again on every pass.
    const content = await api.getContent(suggestion.messageId);
    const body = {
      bodyText: sealPart(db, accountId, suggestion.messageId, 'text', content?.text ?? '')!,
      bodyHtml: sealPart(db, accountId, suggestion.messageId, 'html', content?.html ?? null),
      fetchedAt: now(),
    };
    await db
      .insert(suggestionBodies)
      .values({ accountId, messageId: suggestion.messageId, ...body })
      .onConflictDoUpdate({ target: [suggestionBodies.userId, suggestionBodies.accountId, suggestionBodies.messageId], set: body });
    if (!inHand) fetched++;
  }
  return fetched;
}
