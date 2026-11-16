import type { Sql } from '../store/sql.ts';
import type { LabelChange } from '../store/actions.ts';
import { listLabels } from '../store/labels.ts';
import type { DecidedDisposition, Disposition } from '../triage/types.ts';
import { applyFeedback } from './feedback.ts';

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
export async function userChanges(db: Sql, accountId: string, history: readonly MessageChange[], since: number): Promise<MessageChange[]> {
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
  const own = await db.all<{ message_id: string; payload_json: string }>(
    `SELECT message_id, payload_json FROM actions WHERE account_id = ? AND message_id IS NOT NULL AND created_at >= ? AND status != 'failed'`,
    accountId,
    since,
  );
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

/** What correction detection reads from Gmail. Nothing here changes the mailbox. */
export interface GmailState {
  getLabelIds(messageId: string): Promise<string[] | null>;
  listLabels(): Promise<{ id: string; name: string }[]>;
}

const SYSTEM = new Set(['INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'CHAT']);
const isUserLabel = (id: string) => !SYSTEM.has(id) && !id.startsWith('CATEGORY_');
const moves = (labels: string[]) => labels.includes('INBOX') || labels.includes('SPAM');

interface Standing {
  id: number;
  label_id: string | null;
  disposition: Disposition;
  mode: 'act' | 'observe';
  stage: string;
  rule_id: string | null;
  from_address: string;
}

/**
 * Treat what the user did to a message in Gmail as their answer about that one message: moving it back
 * to the inbox or out of spam, archiving it or marking it spam, or giving it a different `sift/…` label.
 * `changes` must be the user's own (see `userChanges`). Where the message is now, read fresh, is what
 * they want; a move alone does not say what the mail is, so it keeps the label sift gave it and records
 * the different outcome. The answer is recorded as the dashboard's "only this one" is: never a rule, and
 * nothing is changed in Gmail, since the message is already where the user put it. Mail sift could not
 * place is skipped unless the user labelled it. Safe to run again over the same history.
 * Returns how many answers were recorded.
 */
export async function learnFromGmail(db: Sql, accountId: string, changes: readonly MessageChange[], gmail: GmailState, now: number): Promise<number> {
  const labels = await listLabels(db, accountId, now);
  let names: Map<string, string> | undefined;
  let learned = 0;

  for (const change of changes) {
    const decision = await db.get<Standing>(
      `SELECT d.id, d.label_id, d.disposition, d.mode, d.stage, d.rule_id, m.from_address
       FROM decisions d JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND d.message_id = ? ORDER BY d.id DESC LIMIT 1`,
      accountId,
      change.messageId,
    );
    if (!decision) continue;
    const touched = [...change.added, ...change.removed];
    const moved = moves(touched);
    if (!moved && !touched.some(isUserLabel)) continue;
    names ??= new Map((await gmail.listLabels()).map((l) => [l.id, l.name]));
    const siftLabel = (id: string) => labels.find((l) => l.gmailLabel === names?.get(id));
    if (!moved && !touched.some(siftLabel)) continue;

    const current = await gmail.getLabelIds(change.messageId);
    if (current === null || current.includes('TRASH')) continue;
    const place: DecidedDisposition = current.includes('SPAM') ? 'spam' : current.includes('INBOX') ? 'keep' : 'archive';
    const on = current.flatMap((id) => siftLabel(id) ?? []);
    const given = change.added.flatMap((id) => siftLabel(id) ?? []).filter((l) => on.includes(l));
    const label = given.length === 1 ? given[0] : on.length === 1 ? on[0] : labels.find((l) => l.id === decision.label_id);
    if (!label) continue;

    const agrees = decision.label_id === label.id && (decision.disposition === 'review' ? 'keep' : decision.disposition) === place;
    if (agrees) {
      // Doing what sift only suggested confirms it, once. Anything else here is sift's own work or the user's earlier answer, seen again.
      const saidByUser = decision.stage === 'rules' && decision.rule_id === null;
      if (!moved || decision.mode !== 'observe' || saidByUser || (await db.get('SELECT 1 FROM feedback WHERE decision_id = ?', decision.id))) continue;
    } else if (
      await db.get(
        `SELECT 1 FROM feedback f JOIN examples e ON e.account_id = f.account_id AND e.message_id = f.message_id
         WHERE f.decision_id = ? AND f.label_id = ? AND e.disposition = ?`,
        decision.id,
        label.id,
        place,
      )
    )
      continue;

    await applyFeedback(
      db,
      {
        accountId,
        sender: decision.from_address,
        label: label.id,
        ...(place === label.disposition ? {} : { disposition: place }),
        scope: 'once',
        decisionId: decision.id,
        messageId: change.messageId,
        mode: 'observe',
      },
      now,
    );
    await db.run(`UPDATE feedback SET via = 'gmail' WHERE account_id = ? AND message_id = ? AND created_at = ?`, accountId, change.messageId, now);
    learned++;
  }
  return learned;
}
