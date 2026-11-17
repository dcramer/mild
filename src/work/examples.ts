import { and, asc, eq, examples } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import type { GmailApi } from '../gmail/api.ts';
import { sealPart } from '../store/content.ts';

const PER_PASS = 50;

const pending = (db: Sql, accountId: string, limit: number) =>
  db
    .select({ messageId: examples.messageId })
    .from(examples)
    .where(and(eq(examples.accountId, accountId), eq(examples.status, 'pending')))
    .orderBy(asc(examples.markedAt), asc(examples.messageId))
    .limit(limit);

/** Whether `captureExamples` has a marked message to store. */
export const examplesDue = async (db: Sql, accountId: string): Promise<boolean> => (await pending(db, accountId, 1)).length > 0;

/**
 * Fetch the text and HTML of messages the user has marked and store it with their answer, as evaluation and
 * training data. A message that no longer exists is recorded as gone, keeping the answer. A failed
 * fetch leaves the example pending for the next pass. Returns how many were captured.
 */
export async function captureExamples(db: Sql, api: Pick<GmailApi, 'getContent'>, accountId: string): Promise<number> {
  let captured = 0;
  for (const { messageId } of await pending(db, accountId, PER_PASS)) {
    const example = and(eq(examples.accountId, accountId), eq(examples.messageId, messageId));
    const content = await api.getContent(messageId);
    if (content === null) {
      await db.update(examples).set({ status: 'gone' }).where(example);
      continue;
    }
    await db
      .update(examples)
      .set({
        status: 'captured',
        bodyText: sealPart(db, accountId, messageId, 'text', content.text),
        bodyHtml: sealPart(db, accountId, messageId, 'html', content.html),
      })
      .where(example);
    captured++;
  }
  return captured;
}
