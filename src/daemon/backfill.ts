import type { Sql } from '../store/sql.ts';
import type { GmailApi } from '../gmail/api.ts';
import { toFacts } from '../gmail/sync.ts';
import { and, eq, inArray, messages as messageRows } from '../store/query.ts';
import { recordBackfill } from '../store/accounts.ts';
import type { MessageFacts } from '../triage/types.ts';

/** Enough to teach with, and a bound on what one click can spend on model calls. */
export const MAX_BACKFILL = 300;
/** Recorded this many at a time, so a run cut short keeps what it fetched. */
const CHUNK = 50;

/**
 * Pull the inbox's last `days` days into sift so there is something to teach with before new mail
 * arrives. The messages are marked suggest-only: the next pass decides them, and nothing is ever done to
 * them in Gmail. Fetches none after `until`; run again, it skips what it already has. True when done.
 */
export async function backfill(
  db: Sql,
  api: Pick<GmailApi, 'searchInbox' | 'getMetadata'>,
  accountId: string,
  days: number,
  until = Infinity,
  now: () => number = Date.now,
): Promise<boolean> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api.searchInbox(`newer_than:${days}d`, pageToken);
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_BACKFILL);

  const wanted = ids.slice(0, MAX_BACKFILL);
  const known = new Set(
    wanted.length === 0
      ? []
      : (
          await db
            .select({ id: messageRows.id })
            .from(messageRows)
            .where(and(eq(messageRows.accountId, accountId), inArray(messageRows.id, wanted)))
        ).map((r) => r.id),
  );
  let unrecorded: MessageFacts[] = [];
  for (const id of wanted) {
    if (known.has(id)) continue;
    if (now() >= until) {
      await recordBackfill(db, accountId, unrecorded, now());
      return false;
    }
    const raw = await api.getMetadata(id);
    const facts = raw ? toFacts(accountId, raw) : null;
    if (facts) unrecorded.push(facts);
    if (unrecorded.length === CHUNK) {
      await recordBackfill(db, accountId, unrecorded, now());
      unrecorded = [];
    }
  }
  await recordBackfill(db, accountId, unrecorded, now());
  return true;
}
