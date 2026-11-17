import { and, eq, suggestionBodies } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import type { GmailApi } from '../gmail/api.ts';
import { pendingSuggestions } from '../learn/feedback.ts';
import { sealPart } from '../store/content.ts';

const PER_PASS = 50;
export const KEEP_BODY_DAYS = 30;

/** The waiting mail whose text is to be kept, what of it is stored, and what is stored that is not to be kept. */
async function bodies(db: Sql, accountId: string, now: number) {
  const cutoff = now - KEEP_BODY_DAYS * 86_400_000;
  const waiting = (await pendingSuggestions(db, { accountId })).filter((s) => s.disposition !== 'keep' && s.decidedAt >= cutoff).map((s) => s.messageId);
  const wanted = new Set(waiting);
  const stored = await db
    .select({ messageId: suggestionBodies.messageId, fetchedAt: suggestionBodies.fetchedAt })
    .from(suggestionBodies)
    .where(eq(suggestionBodies.accountId, accountId));
  const have = new Set<string>();
  const drop: string[] = [];
  for (const row of stored) {
    if (wanted.has(row.messageId) && row.fetchedAt >= cutoff) have.add(row.messageId);
    else drop.push(row.messageId);
  }
  return { waiting, have, drop };
}

/** Whether `keepSuggestionBodies` has text to fetch or to drop. */
export async function bodiesDue(db: Sql, accountId: string, now: number): Promise<boolean> {
  const { waiting, have, drop } = await bodies(db, accountId, now);
  return drop.length > 0 || waiting.some((id) => !have.has(id));
}

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
  const { waiting, have, drop } = await bodies(db, accountId, now());
  for (const messageId of drop)
    await db.delete(suggestionBodies).where(and(eq(suggestionBodies.accountId, accountId), eq(suggestionBodies.messageId, messageId)));

  let fetched = 0;
  for (const messageId of waiting) {
    if (have.has(messageId)) continue;
    const inHand = held(messageId);
    if (!inHand && (!fetch || fetched >= PER_PASS)) continue;
    // A message that has gone is stored empty, so it is not asked for again on every pass.
    const content = await api.getContent(messageId);
    const body = {
      bodyText: sealPart(db, accountId, messageId, 'text', content?.text ?? '')!,
      bodyHtml: sealPart(db, accountId, messageId, 'html', content?.html ?? null),
      fetchedAt: now(),
    };
    await db
      .insert(suggestionBodies)
      .values({ accountId, messageId, ...body })
      .onConflictDoUpdate({ target: [suggestionBodies.userId, suggestionBodies.accountId, suggestionBodies.messageId], set: body });
    if (!inHand) fetched++;
  }
  return fetched;
}
