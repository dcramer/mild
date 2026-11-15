import type { DatabaseSync } from 'node:sqlite';
import { accuracy, pendingSuggestions } from '../learn/feedback.ts';
import { listLabels } from '../store/labels.ts';
import {
  type DecisionRow,
  type LabelSummary,
  type MessageDetail,
  type RuleSummary,
  STAGES,
  type StageKey,
  type SuggestionGroup,
  type Suggestions,
  type Summary,
} from './types.ts';
import type { ChangeRow } from './types.ts';

export type { DecisionRow, MessageDetail, RuleSummary, StageKey, Summary } from './types.ts';

const emptyCounts = () => Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<StageKey, number>;
const DAY_MS = 86_400_000;
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Everything the dashboard shows, for the last `days` days. Read-only. */
export function summarize(db: DatabaseSync, days: number, now: number = Date.now()): Summary {
  const since = now - days * DAY_MS;
  const one = <T>(sql: string, ...params: (string | number)[]) => db.prepare(sql).get(...params) as T;
  const all = <T>(sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params) as T[];

  const accounts = all<{ email: string; last_synced_at: number | null }>('SELECT email, last_synced_at FROM accounts ORDER BY email');
  const decisionTotals = one<{ n: number; free: number | null; cost: number | null }>(
    'SELECT count(*) AS n, sum(model IS NULL) AS free, sum(cost_usd) AS cost FROM decisions WHERE decided_at >= ?',
    since,
  );

  const stageRows = all<{ stage: StageKey; n: number; cost: number; tokens: number }>(
    `SELECT stage, count(*) AS n, sum(cost_usd) AS cost, sum(input_tokens + output_tokens) AS tokens
     FROM decisions WHERE decided_at >= ? GROUP BY stage`,
    since,
  );
  const byStage = STAGES.map((stage) => {
    const row = stageRows.find((r) => r.stage === stage);
    return { stage, decisions: row?.n ?? 0, costUsd: row?.cost ?? 0, tokens: row?.tokens ?? 0 };
  });

  const dailyByDay = new Map<string, Record<StageKey, number>>();
  for (let i = days - 1; i >= 0; i--) dailyByDay.set(localDay(now - i * DAY_MS), emptyCounts());
  for (const row of all<{ decided_at: number; stage: StageKey }>('SELECT decided_at, stage FROM decisions WHERE decided_at >= ?', since)) {
    const counts = dailyByDay.get(localDay(row.decided_at));
    if (counts && row.stage in counts) counts[row.stage]++;
  }

  return {
    days,
    generatedAt: now,
    accounts: accounts.map((a) => ({ email: a.email, lastSyncedAt: a.last_synced_at })),
    totals: {
      messages: one<{ n: number }>('SELECT count(*) AS n FROM messages WHERE received_at >= ?', since).n,
      decisions: decisionTotals.n,
      withoutInference: decisionTotals.free ?? 0,
      costUsd: decisionTotals.cost ?? 0,
      awaitingTriage: one<{ n: number }>(
        `SELECT count(*) AS n FROM messages m
         WHERE NOT EXISTS (SELECT 1 FROM decisions d WHERE d.account_id = m.account_id AND d.message_id = m.id)`,
      ).n,
      openQuestions: one<{ n: number }>('SELECT count(*) AS n FROM questions WHERE answered_at IS NULL').n,
      troubledActions: one<{ n: number }>(`SELECT count(*) AS n FROM actions WHERE created_at >= ? AND status IN ('failed', 'unknown', 'pending')`, since).n,
    },
    byStage,
    byDisposition: all<{ disposition: string; n: number }>(
      'SELECT disposition, count(*) AS n FROM decisions WHERE decided_at >= ? GROUP BY disposition ORDER BY n DESC',
      since,
    ).map((r) => ({ disposition: r.disposition, decisions: r.n })),
    daily: [...dailyByDay].map(([day, counts]) => ({ day, counts })),
    topSenders: all<{ address: string; n: number; last: string | null }>(
      `SELECT m.from_address AS address, count(*) AS n,
              (SELECT d.disposition FROM decisions d JOIN messages m2 ON m2.account_id = d.account_id AND m2.id = d.message_id
               WHERE m2.from_address = m.from_address ORDER BY d.id DESC LIMIT 1) AS last
       FROM messages m WHERE m.received_at >= ? GROUP BY m.from_address ORDER BY n DESC, address LIMIT 10`,
      since,
    ).map((r) => ({ address: r.address, messages: r.n, lastDisposition: r.last })),
    recent: listDecisions(db, { days, limit: 10 }, now).rows,
  };
}

const DISPOSITIONS = ['keep', 'archive', 'spam', 'review'] as const;

interface DecisionSqlRow {
  id: number;
  account_id: string;
  message_id: string;
  decided_at: number;
  stage: StageKey;
  disposition: string;
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
  action_id: number | null;
  action_type: string | null;
  action_status: string | null;
}

const DECISION_SELECT = `
  SELECT d.id, d.account_id, d.message_id, d.decided_at, d.stage, d.disposition, d.label_id, l.name AS label_name, d.gmail_label, d.reason, d.confidence, d.model, d.cost_usd,
         m.from_address, m.from_name, m.subject, d.mode, d.outcome, d.outcome_detail,
         a.id AS action_id, a.type AS action_type, a.status AS action_status
  FROM decisions d
  JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
  LEFT JOIN labels l ON l.account_id = d.account_id AND l.id = d.label_id
  LEFT JOIN actions a ON a.id = (SELECT max(id) FROM actions WHERE decision_id = d.id)`;

const toDecisionRow = (r: DecisionSqlRow): DecisionRow => ({
  id: r.id,
  accountId: r.account_id,
  messageId: r.message_id,
  decidedAt: r.decided_at,
  stage: r.stage,
  disposition: r.disposition,
  labelId: r.label_id,
  labelName: r.label_name,
  gmailLabel: r.gmail_label,
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
});

export interface DecisionFilter {
  days: number;
  stage?: string;
  disposition?: string;
  /** Case-insensitive substring of the subject, sender address or sender name. */
  search?: string;
  limit?: number;
  offset?: number;
}

/** Decisions in the window, newest first, with the total number that match the filter. Unknown filter values match nothing. */
export function listDecisions(db: DatabaseSync, filter: DecisionFilter, now: number = Date.now()): { total: number; rows: DecisionRow[] } {
  const where = ['d.decided_at >= ?'];
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
  const search = filter.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(m.subject LIKE ? ESCAPE '\\' OR m.from_address LIKE ? ESCAPE '\\' OR coalesce(m.from_name, '') LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern);
  }
  const clause = where.join(' AND ');
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const { total } = db
    .prepare(`SELECT count(*) AS total FROM decisions d JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id WHERE ${clause}`)
    .get(...params) as { total: number };
  const rows = db
    .prepare(`${DECISION_SELECT} WHERE ${clause} ORDER BY d.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as DecisionSqlRow[];
  return { total, rows: rows.map(toDecisionRow) };
}

/** One message with its full history, or null if sift has not seen it. */
export function messageDetail(db: DatabaseSync, accountId: string, messageId: string): MessageDetail | null {
  const m = db
    .prepare(
      `SELECT thread_id, from_address, from_name, to_json, cc_json, subject, list_id, received_at, synced_at, headers_json
       FROM messages WHERE account_id = ? AND id = ?`,
    )
    .get(accountId, messageId) as
    | {
        thread_id: string;
        from_address: string;
        from_name: string | null;
        to_json: string;
        cc_json: string;
        subject: string;
        list_id: string | null;
        received_at: number;
        synced_at: number | null;
        headers_json: string;
      }
    | undefined;
  if (!m) return null;

  const decisions = db
    .prepare(
      `SELECT x.*, d.rule_id, d.input_tokens, d.output_tokens, d.duration_ms
       FROM (${DECISION_SELECT} WHERE d.account_id = ? AND d.message_id = ?) x JOIN decisions d ON d.id = x.id ORDER BY x.id`,
    )
    .all(accountId, messageId) as unknown as (DecisionSqlRow & {
    rule_id: string | null;
    input_tokens: number;
    output_tokens: number;
    duration_ms: number | null;
  })[];
  const actions = db
    .prepare(
      `SELECT id, type, status, decision_id, payload_json, original_labels, final_labels, error, created_at
       FROM actions WHERE account_id = ? AND message_id = ? ORDER BY id`,
    )
    .all(accountId, messageId) as unknown as {
    id: number;
    type: string;
    status: string;
    decision_id: number | null;
    payload_json: string;
    original_labels: string | null;
    final_labels: string | null;
    error: string | null;
    created_at: number;
  }[];

  return {
    accountId,
    messageId,
    threadId: m.thread_id,
    fromAddress: m.from_address,
    fromName: m.from_name,
    to: JSON.parse(m.to_json) as MessageDetail['to'],
    cc: JSON.parse(m.cc_json) as MessageDetail['cc'],
    subject: m.subject,
    listId: m.list_id,
    receivedAt: m.received_at,
    syncedAt: m.synced_at,
    headers: JSON.parse(m.headers_json) as Record<string, string>,
    decisions: decisions.map((r) => ({
      ...toDecisionRow(r),
      ruleId: r.rule_id,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      durationMs: r.duration_ms,
    })),
    actions: actions.map((a) => {
      const payload = JSON.parse(a.payload_json) as { add?: string[]; remove?: string[] };
      return {
        id: a.id,
        type: a.type,
        status: a.status,
        decisionId: a.decision_id,
        added: payload.add ?? [],
        removed: payload.remove ?? [],
        originalLabels: a.original_labels ? (JSON.parse(a.original_labels) as string[]) : [],
        finalLabels: a.final_labels ? (JSON.parse(a.final_labels) as string[]) : null,
        error: a.error,
        createdAt: a.created_at,
      };
    }),
  };
}

/** Every rule in evaluation order, with its label, what it does, and how often and how recently it decided a message. */
export function listRuleSummaries(db: DatabaseSync): RuleSummary[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.account_id, r.match_json, r.except_json, r.label_id, l.name AS label_name, r.disposition AS override, l.disposition AS label_does,
              r.source, r.hits, r.filter_id, r.created_at,
              (SELECT max(decided_at) FROM decisions d WHERE d.rule_id = r.id) AS last_hit_at
       FROM rules r LEFT JOIN labels l ON l.account_id = r.account_id AND l.id = r.label_id
       ORDER BY r.account_id, r.position, r.id`,
    )
    .all() as unknown as {
    id: string;
    account_id: string;
    match_json: string;
    except_json: string;
    label_id: string;
    label_name: string | null;
    override: string | null;
    label_does: string | null;
    source: string;
    hits: number;
    filter_id: string | null;
    created_at: number;
    last_hit_at: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    match: JSON.parse(r.match_json) as Record<string, string>,
    except: JSON.parse(r.except_json) as Record<string, string>[],
    labelId: r.label_id,
    labelName: r.label_name,
    override: r.override,
    disposition: r.label_name === null ? null : (r.override ?? r.label_does),
    source: r.source,
    hits: r.hits,
    lastHitAt: r.last_hit_at,
    filterId: r.filter_id,
    createdAt: r.created_at,
  }));
}

/** An account's labels, each with how much depends on it and how often sift has had it right. */
export function listLabelSummaries(db: DatabaseSync, accountId: string): LabelSummary[] {
  const counts = (sql: string) =>
    new Map((db.prepare(sql).all(accountId) as unknown as { id: string; n: number; right?: number }[]).map((r) => [r.id, r] as const));
  const rules = counts('SELECT label_id AS id, count(*) AS n FROM rules WHERE account_id = ? GROUP BY label_id');
  const messages = counts(
    `SELECT d.label_id AS id, count(*) AS n FROM decisions d
     WHERE d.account_id = ? AND d.label_id IS NOT NULL
       AND d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
     GROUP BY d.label_id`,
  );
  const record = counts(
    `SELECT d.label_id AS id, count(*) AS n, sum(f.verdict = 'right') AS right FROM feedback f JOIN decisions d ON d.id = f.decision_id
     WHERE f.account_id = ? AND f.verdict IN ('right', 'wrong') AND d.label_id IS NOT NULL GROUP BY d.label_id`,
  );
  return listLabels(db, accountId).map((l) => ({
    ...l,
    rules: rules.get(l.id)?.n ?? 0,
    messages: messages.get(l.id)?.n ?? 0,
    record: { reviewed: record.get(l.id)?.n ?? 0, right: record.get(l.id)?.right ?? 0 },
  }));
}

const SAMPLE = 4;
const MAX_GROUPS = 100;

/**
 * What is waiting on the user, grouped so one answer can settle a sender: mail from the same sender
 * that sift would treat the same way. Biggest groups first, since they teach the most.
 */
export function listSuggestions(db: DatabaseSync, options: { includeKept?: boolean } = {}): Suggestions {
  const accounts = db.prepare('SELECT id FROM accounts').all() as { id: string }[];
  const labels = new Map(accounts.map(({ id }) => [id, listLabels(db, id)] as const));
  const names = new Map([...labels].flatMap(([account, list]) => list.map((l) => [`${account}\n${l.id}`, l.name] as const)));
  const groups = new Map<string, SuggestionGroup>();
  let waiting = 0;
  for (const s of pendingSuggestions(db)) {
    if (s.disposition === 'keep' && !options.includeKept) continue;
    waiting++;
    const key = `${s.accountId}\n${s.fromAddress}\n${s.disposition}\n${s.labelId ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        accountId: s.accountId,
        sender: s.fromAddress,
        senderName: s.fromName,
        disposition: s.disposition,
        labelId: s.labelId,
        labelName: (s.labelId && names.get(`${s.accountId}\n${s.labelId}`)) ?? null,
        stage: s.stage,
        messages: 0,
        latestAt: s.decidedAt,
        sample: [],
      };
      groups.set(key, group);
    }
    group.messages++;
    if (group.sample.length < SAMPLE)
      group.sample.push({ decisionId: s.decisionId, messageId: s.messageId, subject: s.subject, reason: s.reason, decidedAt: s.decidedAt });
  }
  const { reviewed, right } = accuracy(db);
  const examples = db.prepare(`SELECT sum(status = 'captured') AS captured, sum(status = 'pending') AS pending FROM examples`).get() as {
    captured: number | null;
    pending: number | null;
  };
  return {
    labels: Object.fromEntries([...labels].map(([id, list]) => [id, list.map((l) => ({ id: l.id, name: l.name, disposition: l.disposition }))])),
    examples: { captured: examples.captured ?? 0, pending: examples.pending ?? 0 },
    groups: [...groups.values()].toSorted((a, b) => b.messages - a.messages || b.latestAt - a.latestAt).slice(0, MAX_GROUPS),
    waiting,
    accuracy: { reviewed, right },
  };
}

/** Changes sift made to the mailbox, newest first, with the message each was about. */
export function listChanges(db: DatabaseSync, limit: number): ChangeRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.account_id, a.message_id, a.type, a.status, a.error, a.created_at, a.payload_json, m.subject, m.from_address
       FROM actions a LEFT JOIN messages m ON m.account_id = a.account_id AND m.id = a.message_id
       WHERE a.message_id IS NOT NULL ORDER BY a.id DESC LIMIT ?`,
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
