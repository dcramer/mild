import type { Sql } from './sql.ts';

export type ActionStatus = 'pending' | 'done' | 'failed' | 'unknown' | 'undone';

/** The label change an action made (or tried to make), as provider label ids. */
export interface LabelChange {
  add: string[];
  remove: string[];
}

export interface ActionPayload extends LabelChange {
  /** For `undo` actions, the id of the action being reversed. */
  undoOf?: number;
  /** For `unsubscribe` actions, which changes no label: the host the request went to. */
  unsubscribe?: string;
  /** For `filter` and `unfilter` actions, which change no message: the rule, and the Gmail filter written for it or taken out. */
  filter?: { ruleId: string; id?: string; criteria?: Record<string, unknown>; action?: Record<string, unknown> };
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
export async function insertPendingAction(
  db: Sql,
  action: { accountId: string; messageId: string | null; type: string; payload: ActionPayload; originalLabels: string[]; decisionId?: number },
  now: number,
): Promise<number> {
  const result = await db.run(
    `INSERT INTO actions (account_id, message_id, type, payload_json, original_labels, decision_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    action.accountId,
    action.messageId,
    action.type,
    JSON.stringify(action.payload),
    JSON.stringify(action.originalLabels),
    action.decisionId ?? null,
    now,
  );
  return result.lastInsertRowid;
}

export async function finishAction(db: Sql, id: number, status: ActionStatus, finalLabels: string[] | null, error: string | null, now: number): Promise<void> {
  await db.run(
    'UPDATE actions SET status = ?, final_labels = ?, error = ?, completed_at = ? WHERE id = ?',
    status,
    finalLabels === null ? null : JSON.stringify(finalLabels),
    error,
    now,
    id,
  );
}

export async function setActionStatus(db: Sql, id: number, status: ActionStatus): Promise<void> {
  await db.run('UPDATE actions SET status = ? WHERE id = ?', status, id);
}

export async function getAction(db: Sql, id: number): Promise<ActionRecord | null> {
  const row = await db.get<Row>(`SELECT ${COLUMNS} FROM actions WHERE id = ?`, id);
  return row ? fromRow(row) : null;
}

/** The last thing sift did to a message's labels that still stands, or null. */
export async function lastStandingChange(db: Sql, accountId: string, messageId: string): Promise<ActionRecord | null> {
  const row = await db.get<Row>(
    `SELECT ${COLUMNS} FROM actions WHERE account_id = ? AND message_id = ? AND type NOT IN ('undo', 'unsubscribe') AND status = 'done' ORDER BY id DESC LIMIT 1`,
    accountId,
    messageId,
  );
  return row ? fromRow(row) : null;
}

/** Actions whose outcome was never confirmed, oldest first. Optionally limited to one message. */
export async function listOpenActions(db: Sql, scope?: { accountId: string; messageId: string }): Promise<ActionRecord[]> {
  const open = `status IN ('pending', 'unknown') AND message_id IS NOT NULL`;
  const rows = scope
    ? await db.all(`SELECT ${COLUMNS} FROM actions WHERE ${open} AND account_id = ? AND message_id = ? ORDER BY id`, scope.accountId, scope.messageId)
    : await db.all(`SELECT ${COLUMNS} FROM actions WHERE ${open} ORDER BY id`);
  return (rows as unknown as Row[]).map(fromRow);
}

/** When the user unsubscribed from this sender through sift, or null. */
export async function unsubscribedAt(db: Sql, accountId: string, sender: string): Promise<number | null> {
  const row = (await db.get<{ at: number | null }>(
    `SELECT min(a.created_at) AS at FROM actions a JOIN messages m ON m.account_id = a.account_id AND m.id = a.message_id
       WHERE a.account_id = ? AND a.type = 'unsubscribe' AND a.status = 'done' AND m.from_address = ?`,
    accountId,
    sender,
  ))!;
  return row.at;
}

/** When an unsubscribe request to this sender last failed, or null. */
export async function lastUnsubscribeFailure(db: Sql, accountId: string, sender: string): Promise<number | null> {
  const row = (await db.get<{ at: number | null }>(
    `SELECT max(a.created_at) AS at FROM actions a JOIN messages m ON m.account_id = a.account_id AND m.id = a.message_id
       WHERE a.account_id = ? AND a.type = 'unsubscribe' AND a.status = 'failed' AND m.from_address = ?`,
    accountId,
    sender,
  ))!;
  return row.at;
}
