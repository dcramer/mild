import { and, asc, eq, examples } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import type { GmailApi } from '../gmail/api.ts';
import { sealPart } from '../store/content.ts';

const PER_PASS = 50;

/**
 * Fetch the text and HTML of messages the user has marked and store it with their answer, as evaluation and
 * training data. A message that no longer exists is recorded as gone, keeping the answer. A failed
 * fetch leaves the example pending for the next pass. Returns how many were captured.
 */
export async function captureExamples(db: Sql, api: Pick<GmailApi, 'getContent'>, accountId: string, now: () => number = Date.now): Promise<number> {
  const pending = await db
    .select({ messageId: examples.messageId })
    .from(examples)
    .where(and(eq(examples.accountId, accountId), eq(examples.status, 'pending')))
    .orderBy(asc(examples.markedAt), asc(examples.messageId))
    .limit(PER_PASS);
  let captured = 0;
  for (const { messageId } of pending) {
    const example = and(eq(examples.accountId, accountId), eq(examples.messageId, messageId));
    const content = await api.getContent(messageId);
    if (content === null) {
      await db.update(examples).set({ status: 'gone', capturedAt: now() }).where(example);
      continue;
    }
    await db
      .update(examples)
      .set({
        status: 'captured',
        bodyText: sealPart(db, accountId, messageId, 'text', content.text),
        bodyHtml: sealPart(db, accountId, messageId, 'html', content.html),
        capturedAt: now(),
      })
      .where(example);
    captured++;
  }
  return captured;
}
