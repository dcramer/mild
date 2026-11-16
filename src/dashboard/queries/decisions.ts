import type { DatabaseSync } from 'node:sqlite';
import { type Scope, within } from '../scope.ts';
import { type DecisionRow, STAGES, type StageKey, type ChangeRow } from '../types.ts';

export const DAY_MS = 86_400_000;

const DISPOSITIONS = ['keep', 'archive', 'spam', 'review'] as const;

export interface DecisionSqlRow {
  id: number;
  account_id: string;
  message_id: string;
  decided_at: number;
  stage: StageKey;
  disposition: string;
  block: number;
  subscription: string;
  label_id: string | null;
  label_name: string | null;
  gmail_label: string | null;
  reason: string;
  confidence: number | null;
  model: string | null;
  cost_usd: number;
  from_address: string;
  from_name: string | null;
  subject: string;
  mode: string;
  outcome: string | null;
  outcome_detail: string | null;
  by_user: number;
  action_id: number | null;
  action_type: string | null;
  action_status: string | null;
}

export const DECISION_SELECT = `
  SELECT d.id, d.account_id, d.message_id, d.decided_at, d.stage, d.disposition, d.block, d.subscription, d.label_id, l.name AS label_name, d.gmail_label, d.reason, d.confidence, d.model, d.cost_usd,
         m.from_address, m.from_name, m.subject, d.mode, d.outcome, d.outcome_detail, d.by_user,
         a.id AS action_id, a.type AS action_type, a.status AS action_status
  FROM decisions d
  JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
  LEFT JOIN labels l ON l.account_id = d.account_id AND l.id = d.label_id
  LEFT JOIN actions a ON a.id = (SELECT max(id) FROM actions WHERE decision_id = d.id AND type != 'unsubscribe')`;

/** Where a decision has got to, as the dashboard groups it. `trouble`: not carried out, failed, or not confirmed. */
const STATUS_WHERE: Record<string, string> = {
  suggested: "d.mode = 'observe'",
  done: "d.mode = 'act' AND d.outcome IN ('done', 'none') AND coalesce(a.status, 'done') = 'done'",
  undone: "a.status = 'undone'",
  trouble: "d.mode = 'act' AND (d.outcome IS NULL OR d.outcome IN ('failed', 'unknown') OR a.status IN ('failed', 'unknown', 'pending'))",
  // What was done to mail in Gmail, or tried: a change was made or failed. Suggestions and mail left alone are not.
  changed: "d.mode = 'act' AND (a.id IS NOT NULL OR d.outcome IN ('failed', 'unknown'))",
};

/**
 * Try a failed or unconfirmed change again: the decision goes back to waiting, and the next pass carries it
 * out through the executor as it would any other. The user's own answer is retried even while sift only
 * observes; anything else waits for sift to be acting. False if there was nothing to retry.
 */
export function retryDecision(db: DatabaseSync, scope: Scope, id: number): { retried: boolean; waiting: boolean } {
  const row = db
    .prepare(`SELECT by_user FROM decisions WHERE id = ? AND mode = 'act' AND outcome IN ('failed', 'unknown') AND ${within(scope, 'account_id')}`)
    .get(id) as { by_user: number } | undefined;
  if (!row) return { retried: false, waiting: false };
  db.prepare('UPDATE decisions SET outcome = NULL, outcome_detail = NULL WHERE id = ?').run(id);
  return { retried: true, waiting: row.by_user === 0 };
}

export const toDecisionRow = (r: DecisionSqlRow): DecisionRow => ({
  id: r.id,
  accountId: r.account_id,
  messageId: r.message_id,
  decidedAt: r.decided_at,
  stage: r.stage,
  disposition: r.block === 1 ? 'block' : r.disposition,
  labelId: r.label_id,
  labelName: r.label_name,
  gmailLabel: r.gmail_label,
  unsubscribe: r.subscription === 'unsubscribe',
  reason: r.reason,
  confidence: r.confidence,
  model: r.model,
  costUsd: r.cost_usd,
  fromAddress: r.from_address,
  fromName: r.from_name,
  subject: r.subject,
  mode: r.mode,
  outcome: r.outcome,
  outcomeDetail: r.outcome_detail,
  actionId: r.action_id,
  actionType: r.action_type,
  actionStatus: r.action_status,
  byUser: r.by_user === 1,
});

export interface DecisionFilter {
  days: number;
  stage?: string;
  disposition?: string;
  /** `suggested`, `done`, `undone` or `trouble`. */
  status?: string;
  /** Case-insensitive substring of the subject, sender address or sender name. */
  search?: string;
  accountId?: string;
  /** Exact sender address. */
  sender?: string;
  /** Exact sender domain. */
  domain?: string;
  limit?: number;
  offset?: number;
}

/** Decisions in the window, newest first, with the total number that match the filter. Unknown filter values match nothing. */
export function listDecisions(db: DatabaseSync, scope: Scope, filter: DecisionFilter, now: number = Date.now()): { total: number; rows: DecisionRow[] } {
  const where = [within(scope, 'd.account_id'), 'd.decided_at >= ?'];
  const params: (string | number)[] = [now - filter.days * DAY_MS];
  if (filter.stage !== undefined) {
    if (!(STAGES as readonly string[]).includes(filter.stage)) return { total: 0, rows: [] };
    where.push('d.stage = ?');
    params.push(filter.stage);
  }
  if (filter.disposition !== undefined) {
    if (!(DISPOSITIONS as readonly string[]).includes(filter.disposition)) return { total: 0, rows: [] };
    where.push('d.disposition = ?');
    params.push(filter.disposition);
  }
  if (filter.status !== undefined) {
    const clause = STATUS_WHERE[filter.status];
    if (clause === undefined) return { total: 0, rows: [] };
    where.push(clause);
  }
  for (const [column, value] of [
    ['d.account_id', filter.accountId],
    ['m.from_address', filter.sender],
    ['m.from_domain', filter.domain],
  ] as const) {
    if (value === undefined) continue;
    where.push(`${column} = ?`);
    params.push(value);
  }
  const search = filter.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(m.subject LIKE ? ESCAPE '\\' OR m.from_address LIKE ? ESCAPE '\\' OR coalesce(m.from_name, '') LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern);
  }
  const clause = where.join(' AND ');
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const { total } = db.prepare(`SELECT count(*) AS total FROM (${DECISION_SELECT} WHERE ${clause})`).get(...params) as { total: number };
  const rows = db
    .prepare(`${DECISION_SELECT} WHERE ${clause} ORDER BY d.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as DecisionSqlRow[];
  return { total, rows: rows.map(toDecisionRow) };
}

/** Changes sift made to the mailbox, newest first, with the message each was about. */
export function listChanges(db: DatabaseSync, scope: Scope, limit: number): ChangeRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.account_id, a.message_id, a.type, a.status, a.error, a.created_at, a.payload_json, m.subject, m.from_address
       FROM actions a LEFT JOIN messages m ON m.account_id = a.account_id AND m.id = a.message_id
       WHERE a.message_id IS NOT NULL AND ${within(scope, 'a.account_id')} ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit) as unknown as {
    id: number;
    account_id: string;
    message_id: string;
    type: string;
    status: string;
    error: string | null;
    created_at: number;
    payload_json: string;
    subject: string | null;
    from_address: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    messageId: r.message_id,
    type: r.type,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    subject: r.subject,
    fromAddress: r.from_address,
    undoOf: (JSON.parse(r.payload_json) as { undoOf?: number }).undoOf ?? null,
  }));
}
