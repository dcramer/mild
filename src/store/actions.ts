import type { DatabaseSync } from 'node:sqlite';

export type ActionStatus = 'pending' | 'done' | 'failed' | 'unknown' | 'undone';

/** The label change an action made (or tried to make), as provider label ids. */
export interface LabelChange {
  add: string[];
  remove: string[];
}

export interface ActionPayload extends LabelChange {
  /** For `undo` actions, the id of the action being reversed. */
  undoOf?: number;
}

export interface ActionRecord {
  id: number;
  accountId: string;
  messageId: string;
  type: string;
  payload: ActionPayload;
  originalLabels: string[];
  finalLabels: string[] | null;
  status: ActionStatus;
  error: string | null;
  createdAt: number;
}

interface Row {
  id: number;
  account_id: string;
  message_id: string;
  type: string;
  payload_json: string;
  original_labels: string;
  final_labels: string | null;
  status: ActionStatus;
  error: string | null;
  created_at: number;
}

const COLUMNS = 'id, account_id, message_id, type, payload_json, original_labels, final_labels, status, error, created_at';

const fromRow = (r: Row): ActionRecord => ({
  id: r.id,
  accountId: r.account_id,
  messageId: r.message_id,
  type: r.type,
  payload: JSON.parse(r.payload_json) as ActionPayload,
  originalLabels: JSON.parse(r.original_labels) as string[],
  finalLabels: r.final_labels === null ? null : (JSON.parse(r.final_labels) as string[]),
  status: r.status,
  error: r.error,
  createdAt: r.created_at,
});

/** Write the intent before touching the provider. Returns the action id. */
export function insertPendingAction(
  db: DatabaseSync,
  action: { accountId: string; messageId: string; type: string; payload: ActionPayload; originalLabels: string[]; decisionId?: number },
  now: number,
): number {
  const result = db
    .prepare(
      `INSERT INTO actions (account_id, message_id, type, payload_json, original_labels, decision_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      action.accountId,
      action.messageId,
      action.type,
      JSON.stringify(action.payload),
      JSON.stringify(action.originalLabels),
      action.decisionId ?? null,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function finishAction(db: DatabaseSync, id: number, status: ActionStatus, finalLabels: string[] | null, error: string | null, now: number): void {
  db.prepare('UPDATE actions SET status = ?, final_labels = ?, error = ?, completed_at = ? WHERE id = ?').run(
    status,
    finalLabels === null ? null : JSON.stringify(finalLabels),
    error,
    now,
    id,
  );
}

export function setActionStatus(db: DatabaseSync, id: number, status: ActionStatus): void {
  db.prepare('UPDATE actions SET status = ? WHERE id = ?').run(status, id);
}

export function getAction(db: DatabaseSync, id: number): ActionRecord | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM actions WHERE id = ?`).get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Actions whose outcome was never confirmed, oldest first. Optionally limited to one message. */
export function listOpenActions(db: DatabaseSync, scope?: { accountId: string; messageId: string }): ActionRecord[] {
  const open = `status IN ('pending', 'unknown') AND message_id IS NOT NULL`;
  const rows = scope
    ? db.prepare(`SELECT ${COLUMNS} FROM actions WHERE ${open} AND account_id = ? AND message_id = ? ORDER BY id`).all(scope.accountId, scope.messageId)
    : db.prepare(`SELECT ${COLUMNS} FROM actions WHERE ${open} ORDER BY id`).all();
  return (rows as unknown as Row[]).map(fromRow);
}

export function listRecentActions(db: DatabaseSync, limit: number): ActionRecord[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM actions WHERE message_id IS NOT NULL ORDER BY id DESC LIMIT ?`).all(limit);
  return (rows as unknown as Row[]).map(fromRow);
}
