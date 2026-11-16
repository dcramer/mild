import type { DatabaseSync } from 'node:sqlite';
import type { LabelChange } from '../store/actions.ts';

/** Labels put on or taken off one message in Gmail. */
export interface MessageChange {
  messageId: string;
  added: string[];
  removed: string[];
}

/**
 * The part of Gmail's history that sift did not cause: what the user (or another client of theirs) did.
 * History does not say who made a change, so each of sift's own logged changes since `since` cancels one
 * matching entry, and what is left over is the user's. `since` is when the previous sync began: nothing
 * sift did before then can still be in this history, and counting an older action could hide a real change.
 * One entry per message, each label listed once.
 */
export function userChanges(db: DatabaseSync, accountId: string, history: readonly MessageChange[], since: number): MessageChange[] {
  if (history.length === 0) return [];
  // messageId -> "+LABEL" or "-LABEL" -> how many times more than sift did it
  const tally = new Map<string, Map<string, number>>();
  const count = (messageId: string, key: string, by: number) => {
    const counts = tally.get(messageId) ?? new Map<string, number>();
    counts.set(key, (counts.get(key) ?? 0) + by);
    tally.set(messageId, counts);
  };
  for (const change of history) {
    for (const label of change.added) count(change.messageId, `+${label}`, 1);
    for (const label of change.removed) count(change.messageId, `-${label}`, 1);
  }
  // A change whose outcome was never confirmed may have landed, so it counts; one that failed did not.
  const own = db
    .prepare(`SELECT message_id, payload_json FROM actions WHERE account_id = ? AND message_id IS NOT NULL AND created_at >= ? AND status != 'failed'`)
    .all(accountId, since) as { message_id: string; payload_json: string }[];
  for (const action of own) {
    if (!tally.has(action.message_id)) continue;
    const payload = JSON.parse(action.payload_json) as LabelChange;
    for (const label of payload.add) count(action.message_id, `+${label}`, -1);
    for (const label of payload.remove) count(action.message_id, `-${label}`, -1);
  }

  const changes: MessageChange[] = [];
  for (const [messageId, counts] of tally) {
    const left = [...counts].filter(([, n]) => n > 0).map(([key]) => key);
    const added = left.filter((key) => key.startsWith('+')).map((key) => key.slice(1));
    const removed = left.filter((key) => key.startsWith('-')).map((key) => key.slice(1));
    if (added.length > 0 || removed.length > 0) changes.push({ messageId, added, removed });
  }
  return changes;
}
