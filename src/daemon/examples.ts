import { and, asc, eq, examples } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import type { GmailApi } from '../gmail/api.ts';

/** Every header of a raw message, in order. Folded lines are joined. */
export function parseHeaders(raw: Buffer): [string, string][] {
  const text = raw.toString('latin1');
  const end = text.search(/\r?\n\r?\n/);
  const head = (end === -1 ? text : text.slice(0, end)).replace(/\r?\n[ \t]+/g, ' ');
  const headers: [string, string][] = [];
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.push([line.slice(0, colon), line.slice(colon + 1).trim()]);
  }
  return headers;
}

const PER_PASS = 50;

/**
 * Fetch the full content of messages the user has marked and store it with their answer, as evaluation
 * and training data. A message that no longer exists is recorded as gone, keeping the answer. A failed
 * fetch leaves the example pending for the next pass. Returns how many were captured.
 */
export async function captureExamples(
  db: Sql,
  api: Pick<GmailApi, 'getRaw' | 'getBodyText'>,
  accountId: string,
  now: () => number = Date.now,
): Promise<number> {
  const pending = await db
    .select({ messageId: examples.messageId })
    .from(examples)
    .where(and(eq(examples.accountId, accountId), eq(examples.status, 'pending')))
    .orderBy(asc(examples.markedAt), asc(examples.messageId))
    .limit(PER_PASS);
  let captured = 0;
  for (const { messageId } of pending) {
    const example = and(eq(examples.accountId, accountId), eq(examples.messageId, messageId));
    const raw = await api.getRaw(messageId);
    if (raw === null) {
      await db.update(examples).set({ status: 'gone', capturedAt: now() }).where(example);
      continue;
    }
    const body = await api.getBodyText(messageId);
    await db
      .update(examples)
      .set({ status: 'captured', raw, headersJson: JSON.stringify(parseHeaders(raw)), bodyText: body ?? '', capturedAt: now() })
      .where(example);
    captured++;
  }
  return captured;
}
