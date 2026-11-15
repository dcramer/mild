import type { DatabaseSync } from 'node:sqlite';
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
  db: DatabaseSync,
  api: Pick<GmailApi, 'getRaw' | 'getBodyText'>,
  accountId: string,
  now: () => number = Date.now,
): Promise<number> {
  const pending = db
    .prepare(`SELECT message_id FROM examples WHERE account_id = ? AND status = 'pending' ORDER BY marked_at, message_id LIMIT ?`)
    .all(accountId, PER_PASS) as { message_id: string }[];
  let captured = 0;
  for (const { message_id: messageId } of pending) {
    const raw = await api.getRaw(messageId);
    if (raw === null) {
      db.prepare(`UPDATE examples SET status = 'gone', captured_at = ? WHERE account_id = ? AND message_id = ?`).run(now(), accountId, messageId);
      continue;
    }
    const body = await api.getBodyText(messageId);
    db.prepare(
      `UPDATE examples SET status = 'captured', raw = ?, headers_json = ?, body_text = ?, captured_at = ? WHERE account_id = ? AND message_id = ?`,
    ).run(raw, JSON.stringify(parseHeaders(raw)), body ?? '', now(), accountId, messageId);
    captured++;
  }
  return captured;
}
