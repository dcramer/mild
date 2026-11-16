import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { shotCandidates } from '../store/examples.ts';
import { listLabels } from '../store/labels.ts';
import { getFacts } from '../store/messages.ts';
import { deriveFacts } from '../triage/facts.ts';
import { pickShots } from '../triage/fewshot.ts';
import { PROMPT_TEMPLATE } from '../triage/prompt.ts';
import { type Scorecard, score } from '../triage/score.ts';
import type { Evidence, Judge } from '../triage/stages/model.ts';
import type { Disposition, Label, MessageFacts } from '../triage/types.ts';

/** Every example judged is a model call the user pays for, so one run is bounded. */
export const MAX_EVAL_EXAMPLES = 200;
export const DEFAULT_EVAL_EXAMPLES = 50;
const CONCURRENCY = 4;

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

export interface EvalDeps {
  db: DatabaseSync;
  judge: Judge;
  /** `provider/model-id`, as recorded with the run. */
  model: string;
  guidelines: string;
  now?: () => number;
}

export interface EvalRequest {
  accountId: string;
  /** Whether the other stored examples are shown to the model, as they would be for new mail. */
  fewShot: boolean;
  /** How many examples to judge, newest answers first. */
  limit?: number;
}

/**
 * What the model would have been shown when this message arrived, from what is stored: the recorded
 * headers, the example's text, and the sender's history up to the message's first decision. Nothing the
 * user's answer changed afterwards is in it, and Gmail is not asked.
 */
function storedEvidence(db: DatabaseSync, facts: MessageFacts, body: string | null): Evidence {
  const { accountId, messageId } = facts;
  const { first } = db.prepare('SELECT min(id) AS first FROM decisions WHERE account_id = ? AND message_id = ?').get(accountId, messageId) as {
    first: number | null;
  };
  const { n } = db
    .prepare('SELECT count(*) AS n FROM messages WHERE account_id = ? AND from_address = ? AND received_at <= ?')
    .get(accountId, facts.from.address, facts.receivedAt) as { n: number };
  const past = db
    .prepare(
      `SELECT d.disposition, count(*) AS n FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.from_address = ? AND d.message_id != ?
         AND d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id AND x.id < ?)
       GROUP BY d.disposition`,
    )
    .all(accountId, facts.from.address, messageId, first ?? 0) as unknown as { disposition: Disposition; n: number }[];
  const written = db.prepare('SELECT user_has_written AS yes FROM correspondents WHERE account_id = ? AND address = ?').get(accountId, facts.from.address) as
    | { yes: number }
    | undefined;
  return {
    facts,
    known: deriveFacts(facts),
    body,
    sender: {
      messagesSeen: Math.max(1, n),
      userHasWritten: written ? written.yes === 1 : null,
      pastDispositions: Object.fromEntries(past.map((r) => [r.disposition, r.n])),
    },
  };
}

/**
 * Start replaying the model over an account's stored examples, and return at once with the run's id.
 * The run goes on in the background, a few calls at a time; each result is stored as it arrives.
 * `done` resolves when it has finished and never rejects. Only one run at a time. Throws with a
 * message for the user if there is nothing to run.
 */
export function startEval(deps: EvalDeps, request: EvalRequest): { id: number; done: Promise<void> } {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  if (db.prepare(`SELECT 1 FROM eval_runs WHERE status = 'running'`).get()) throw new Error('A test run is already going. Wait for it to finish.');
  const labels = listLabels(db, request.accountId, now());
  const limit = Math.min(Math.max(1, Math.trunc(request.limit ?? DEFAULT_EVAL_EXAMPLES)), MAX_EVAL_EXAMPLES);
  // An example whose label has since gone cannot be answered correctly, so it is left out.
  const examples = (
    db
      .prepare(
        `SELECT message_id, label_id, body_text FROM examples
         WHERE account_id = ? AND status = 'captured' AND label_id IS NOT NULL ORDER BY marked_at DESC, message_id`,
      )
      .all(request.accountId) as unknown as { message_id: string; label_id: string; body_text: string | null }[]
  )
    .filter((e) => labels.some((l) => l.id === e.label_id))
    .slice(0, limit);
  if (examples.length === 0) throw new Error('There are no stored examples to test against yet. Answer some suggestions first.');

  const shown = labels.map((l) => ({ id: l.id, name: l.name, description: l.description }));
  const id = Number(
    db
      .prepare(
        `INSERT INTO eval_runs (account_id, started_at, status, model, prompt_hash, guidelines_hash, labels_hash, labels_json, few_shot, total)
         VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.accountId,
        now(),
        deps.model,
        hash(PROMPT_TEMPLATE),
        hash(deps.guidelines.trim()),
        hash(JSON.stringify(shown)),
        JSON.stringify(shown),
        request.fewShot ? 1 : 0,
        examples.length,
      ).lastInsertRowid,
  );

  const record = db.prepare(
    `INSERT INTO eval_results (run_id, message_id, expected, got, confidence, input_tokens, output_tokens, cost_usd, duration_ms, shots, sender_shots)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const judgeOne = async (example: (typeof examples)[number], labels: readonly Label[]) => {
    const facts = getFacts(db, request.accountId, example.message_id);
    if (!facts) return;
    // `pickShots` leaves out the message itself, so an example is never shown its own answer.
    const shots = request.fewShot ? pickShots(shotCandidates(db, facts), facts, labels) : [];
    const started = performance.now();
    const verdict = await deps
      .judge({ evidence: storedEvidence(db, facts, example.body_text), labels, guidelines: deps.guidelines, ...(shots.length > 0 ? { examples: shots } : {}) })
      .catch(() => null);
    record.run(
      id,
      example.message_id,
      example.label_id,
      verdict?.label ?? null,
      verdict?.confidence ?? null,
      verdict?.usage?.inputTokens ?? 0,
      verdict?.usage?.outputTokens ?? 0,
      verdict?.usage?.costUsd ?? 0,
      Math.round(performance.now() - started),
      shots.length,
      shots.filter((s) => s.fromAddress === facts.from.address).length,
    );
  };

  let next = 0;
  const worker = async () => {
    while (next < examples.length) await judgeOne(examples[next++]!, labels);
  };
  const finish = db.prepare('UPDATE eval_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?');
  const done = Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(
    () => void finish.run('done', null, now(), id),
    (error: unknown) => void finish.run('failed', error instanceof Error ? error.message : String(error), now(), id),
  );
  return { id, done };
}

/** Call when sift starts: a run still marked as going belongs to a process that has stopped. */
export function interruptEvals(db: DatabaseSync, now: number = Date.now()): void {
  db.prepare(`UPDATE eval_runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'`).run(now);
}

export interface EvalRun {
  id: number;
  accountId: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'done' | 'failed' | 'interrupted';
  error: string | null;
  /** What it ran with. Two runs with the same values here differ only by chance and by the examples stored since. */
  model: string;
  promptHash: string;
  guidelinesHash: string;
  labelsHash: string;
  labels: { id: string; name: string; description: string }[];
  fewShot: boolean;
  /** Examples in the run. `score.total` is how many have been judged so far. */
  total: number;
  score: Scorecard;
  /**
   * Of the answers, those given with an example from the same sender in the prompt. These flatter a
   * few-shot run: new mail from a sender the user answered for is usually decided by a rule, not the model.
   */
  withSenderExample: { answered: number; right: number };
}

export interface EvalResult {
  messageId: string;
  fromAddress: string;
  subject: string;
  expected: string;
  got: string | null;
  confidence: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  shots: number;
  senderShots: number;
}

interface RunRow {
  id: number;
  account_id: string;
  started_at: number;
  finished_at: number | null;
  status: EvalRun['status'];
  error: string | null;
  model: string;
  prompt_hash: string;
  guidelines_hash: string;
  labels_hash: string;
  labels_json: string;
  few_shot: number;
  total: number;
}

function results(db: DatabaseSync, runId: number): EvalResult[] {
  const rows = db
    .prepare(
      `SELECT r.message_id, coalesce(m.from_address, '') AS from_address, coalesce(m.subject, '') AS subject, r.expected, r.got, r.confidence,
              r.input_tokens, r.output_tokens, r.cost_usd, r.duration_ms, r.shots, r.sender_shots
       FROM eval_results r JOIN eval_runs e ON e.id = r.run_id
       LEFT JOIN messages m ON m.account_id = e.account_id AND m.id = r.message_id
       WHERE r.run_id = ? ORDER BY r.message_id`,
    )
    .all(runId) as unknown as {
    message_id: string;
    from_address: string;
    subject: string;
    expected: string;
    got: string | null;
    confidence: number | null;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    duration_ms: number;
    shots: number;
    sender_shots: number;
  }[];
  return rows.map((r) => ({
    messageId: r.message_id,
    fromAddress: r.from_address,
    subject: r.subject,
    expected: r.expected,
    got: r.got,
    confidence: r.confidence,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    durationMs: r.duration_ms,
    shots: r.shots,
    senderShots: r.sender_shots,
  }));
}

function toRun(row: RunRow, judged: readonly EvalResult[]): EvalRun {
  const helped = judged.filter((r) => r.senderShots > 0 && r.got !== null);
  return {
    id: row.id,
    accountId: row.account_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    error: row.error,
    model: row.model,
    promptHash: row.prompt_hash,
    guidelinesHash: row.guidelines_hash,
    labelsHash: row.labels_hash,
    labels: JSON.parse(row.labels_json) as EvalRun['labels'],
    fewShot: row.few_shot === 1,
    total: row.total,
    score: score(judged),
    withSenderExample: { answered: helped.length, right: helped.filter((r) => r.got === r.expected).length },
  };
}

/** Past runs with their scores, newest first. */
export function listEvalRuns(db: DatabaseSync, limit = 50): EvalRun[] {
  const rows = db.prepare('SELECT * FROM eval_runs ORDER BY id DESC LIMIT ?').all(limit) as unknown as RunRow[];
  return rows.map((row) => toRun(row, results(db, row.id)));
}

/** One run with what the model said for each example, or null if there is no such run. */
export function getEvalRun(db: DatabaseSync, id: number): { run: EvalRun; results: EvalResult[] } | null {
  const row = db.prepare('SELECT * FROM eval_runs WHERE id = ?').get(id) as unknown as RunRow | undefined;
  if (!row) return null;
  const judged = results(db, id);
  return { run: toRun(row, judged), results: judged };
}
