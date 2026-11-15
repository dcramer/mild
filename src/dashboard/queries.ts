import type { DatabaseSync } from 'node:sqlite';
import { accuracy, pendingSuggestions } from '../learn/feedback.ts';
import { unsubscribedAt } from '../store/actions.ts';
import { listLabels } from '../store/labels.ts';
import { bulkSignals, passedDmarc } from '../triage/features.ts';
import {
  type DecisionRow,
  type LabelSummary,
  type MessageDetail,
  type RuleSummary,
  type SenderProfile,
  type SuggestionDetail,
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
  action_id: number | null;
  action_type: string | null;
  action_status: string | null;
}

const DECISION_SELECT = `
  SELECT d.id, d.account_id, d.message_id, d.decided_at, d.stage, d.disposition, d.block, d.subscription, d.label_id, l.name AS label_name, d.gmail_label, d.reason, d.confidence, d.model, d.cost_usd,
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
    body: storedBody(db, accountId, messageId),
    unsubscribe: canUnsubscribe(db, accountId, m.from_address, JSON.parse(m.headers_json) as Record<string, string>),
    sender: senderProfile(db, accountId, m.from_address),
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

/** The text of a message, if sift is holding it: as a suggestion's temporary copy, or in an example the user made. */
function storedBody(db: DatabaseSync, accountId: string, messageId: string): string | null {
  const row = db
    .prepare(
      `SELECT coalesce(
         (SELECT body_text FROM suggestion_bodies WHERE account_id = ?1 AND message_id = ?2),
         (SELECT body_text FROM examples WHERE account_id = ?1 AND message_id = ?2 AND status = 'captured')) AS body`,
    )
    .get(accountId, messageId) as { body: string | null };
  return row.body;
}

/** Whether sift can leave the list a message came from. Mirrors what `unsubscribe` in src/actions will agree to. */
function canUnsubscribe(db: DatabaseSync, accountId: string, sender: string, headers: Record<string, string>): MessageDetail['unsubscribe'] {
  const signals = bulkSignals(headers);
  if (!signals.hasListUnsubscribe) return 'none';
  if (unsubscribedAt(db, accountId, sender) !== null) return 'done';
  return signals.oneClickUnsubscribeUrl && passedDmarc(headers) ? 'available' : 'manual';
}

/** What sift knows about one sender. */
export function senderProfile(db: DatabaseSync, accountId: string, address: string): SenderProfile {
  const seen = db
    .prepare('SELECT count(*) AS n, min(received_at) AS first FROM messages WHERE account_id = ? AND from_address = ?')
    .get(accountId, address) as {
    n: number;
    first: number | null;
  };
  const written = db.prepare('SELECT user_has_written AS yes FROM correspondents WHERE account_id = ? AND address = ?').get(accountId, address) as
    | { yes: number }
    | undefined;
  const labels = db
    .prepare(
      `SELECT d.label_id AS id, coalesce(l.name, d.label_id) AS name, count(*) AS messages
       FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       LEFT JOIN labels l ON l.account_id = d.account_id AND l.id = d.label_id
       WHERE d.account_id = ? AND m.from_address = ? AND d.label_id IS NOT NULL
         AND d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
       GROUP BY d.label_id ORDER BY messages DESC`,
    )
    .all(accountId, address) as unknown as SenderProfile['labels'];
  const domain = address.split('@')[1] ?? '';
  const rules = listRuleSummaries(db)
    .filter((r) => r.accountId === accountId && (r.match['from'] === address || (r.match['fromDomain'] === domain && r.match['from'] === undefined)))
    .map((r) => ({ id: r.id, match: r.match, labelName: r.labelName, disposition: r.disposition, source: r.source }));
  return { address, messages: seen.n, firstSeenAt: seen.first, userHasWritten: written ? written.yes === 1 : null, labels, rules };
}

/** One sender's waiting mail, newest first, with what sift knows about them. */
export function suggestionDetail(db: DatabaseSync, accountId: string, sender: string): SuggestionDetail {
  const names = new Map(listLabels(db, accountId).map((l) => [l.id, l.name]));
  const received = db.prepare('SELECT received_at FROM messages WHERE account_id = ? AND id = ?');
  return {
    sender: senderProfile(db, accountId, sender),
    messages: pendingSuggestions(db, { accountId, sender, limit: 200 }).map((s) => ({
      decisionId: s.decisionId,
      messageId: s.messageId,
      subject: s.subject,
      receivedAt: (received.get(accountId, s.messageId) as { received_at: number }).received_at,
      disposition: s.block ? 'block' : s.disposition,
      labelId: s.labelId,
      labelName: (s.labelId && names.get(s.labelId)) ?? null,
      stage: s.stage,
      reason: s.reason,
    })),
  };
}

/** Every rule in evaluation order, with its label, what it does, and how often and how recently it decided a message. */
export function listRuleSummaries(db: DatabaseSync): RuleSummary[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.account_id, r.match_json, r.except_json, r.label_id, l.name AS label_name, r.disposition AS override, CASE WHEN l.block = 1 THEN 'block' ELSE l.disposition END AS label_does,
              (r.mark_read = 1 OR l.mark_read = 1) AS mark_read, (r.subscription = 'unsubscribe' OR l.unsubscribe = 1) AS unsubscribe,
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
    mark_read: number | null;
    unsubscribe: number | null;
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
    markRead: r.mark_read === 1,
    unsubscribe: r.unsubscribe === 1,
    source: r.source,
    hits: r.hits,
    lastHitAt: r.last_hit_at,
    filterId: r.filter_id,
    createdAt: r.created_at,
  }));
}

/** What a label does, as the one word the dashboard shows and sets. */
const outcomeOf = (label: { disposition: string; block?: boolean }) => (label.block ? 'block' : label.disposition);

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
    id: l.id,
    name: l.name,
    description: l.description,
    disposition: outcomeOf(l),
    markRead: l.markRead ?? false,
    unsubscribe: l.unsubscribe ?? false,
    gmailLabel: l.gmailLabel,
    rules: rules.get(l.id)?.n ?? 0,
    messages: messages.get(l.id)?.n ?? 0,
    record: { reviewed: record.get(l.id)?.n ?? 0, right: record.get(l.id)?.right ?? 0 },
  }));
}

const SAMPLE = 4;
const MAX_GROUPS = 100;

/**
 * What is waiting on the user, one group per sender, since an answer is about a sender. A group shows
 * the guess sift made for most of that sender's waiting mail. Biggest groups first: they teach the most.
 */
export function listSuggestions(db: DatabaseSync, options: { includeKept?: boolean } = {}): Suggestions {
  const accounts = db.prepare('SELECT id FROM accounts').all() as { id: string }[];
  const labels = new Map(accounts.map(({ id }) => [id, listLabels(db, id)] as const));
  const names = new Map([...labels].flatMap(([account, list]) => list.map((l) => [`${account}\n${l.id}`, l.name] as const)));
  const groups = new Map<string, SuggestionGroup>();
  // Per sender, how many waiting messages got each guess. The commonest is the one the group shows.
  const tallies = new Map<string, Map<string, { n: number; suggestion: (typeof all)[number] }>>();
  const all = pendingSuggestions(db);
  let waiting = 0;
  for (const s of all) {
    if (s.disposition === 'keep' && !options.includeKept) continue;
    waiting++;
    const key = `${s.accountId}\n${s.fromAddress}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        accountId: s.accountId,
        sender: s.fromAddress,
        senderName: s.fromName,
        disposition: s.block ? 'block' : s.disposition,
        labelId: s.labelId,
        labelName: null,
        stage: s.stage,
        unsubscribe: s.unsubscribe,
        guesses: 1,
        messages: 0,
        latestAt: s.decidedAt,
        latestReceivedAt: s.receivedAt,
        sample: [],
      };
      groups.set(key, group);
      tallies.set(key, new Map());
    }
    group.messages++;
    group.latestReceivedAt = Math.max(group.latestReceivedAt, s.receivedAt);
    const tally = tallies.get(key)!;
    const guess = `${s.labelId ?? ''}\n${s.disposition}\n${s.block}`;
    const entry = tally.get(guess);
    if (entry) entry.n++;
    else tally.set(guess, { n: 1, suggestion: s });
    if (group.sample.length < SAMPLE)
      group.sample.push({ decisionId: s.decisionId, messageId: s.messageId, subject: s.subject, reason: s.reason, decidedAt: s.decidedAt });
  }
  for (const [key, group] of groups) {
    const tally = [...tallies.get(key)!.values()];
    const top = tally.reduce((best, entry) => (entry.n > best.n ? entry : best));
    group.guesses = tally.length;
    group.disposition = top.suggestion.block ? 'block' : top.suggestion.disposition;
    group.labelId = top.suggestion.labelId;
    group.labelName = (top.suggestion.labelId && names.get(`${group.accountId}\n${top.suggestion.labelId}`)) ?? null;
    group.stage = top.suggestion.stage;
    group.unsubscribe = top.suggestion.unsubscribe;
  }
  const { reviewed, right } = accuracy(db);
  const examples = db.prepare(`SELECT sum(status = 'captured') AS captured, sum(status = 'pending') AS pending FROM examples`).get() as {
    captured: number | null;
    pending: number | null;
  };
  return {
    labels: Object.fromEntries([...labels].map(([id, list]) => [id, list.map((l) => ({ id: l.id, name: l.name, disposition: outcomeOf(l) }))])),
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
