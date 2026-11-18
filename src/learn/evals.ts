import { createHash } from 'node:crypto';
import {
  type EVAL_STATUSES,
  and,
  correspondents,
  count,
  desc,
  eq,
  evalResults,
  evalRuns,
  examples as exampleRows,
  isNotNull,
  lte,
  messages,
} from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import { mailboxAliases } from '../store/accounts.ts';
import { examplesFor } from '../store/examples.ts';
import { listLabels } from '../store/labels.ts';
import { getFacts } from '../store/messages.ts';
import { hashOf, openEnvelope, openPart, traceIds } from '../store/content.ts';
import { invokeAgent } from '../telemetry.ts';
import { deriveFacts } from '../triage/facts.ts';
import { PROMPT_TEMPLATE } from '../triage/prompt.ts';
import { type Scorecard, score } from '../triage/score.ts';
import { type Evidence, type Judge, type JudgeFailure, describeFailure } from '../triage/stages/model.ts';
import type { MessageFacts } from '../triage/types.ts';
import { Refusal } from '../refusal.ts';
import { plain, seal } from '../plain.ts';
import type { Confidential } from '../confidential.ts';

/** Every example judged is a model call the user pays for, so one run is bounded. */
export const MAX_EVAL_EXAMPLES = 200;
export const DEFAULT_EVAL_EXAMPLES = 50;
const CONCURRENCY = 4;

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

interface EvalDeps {
  db: Sql;
  judge: Judge;
  /** `provider/model-id`, as recorded with the run. */
  model: string;
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
 * headers, the example's text, how much the sender had sent by then and whether the owner has written to
 * them. Nothing the user's answer changed afterwards is in it, and Gmail is not asked. Less than new mail
 * gets: no standing, and none of the sender's other labelled mail.
 */
async function storedEvidence(db: Sql, facts: MessageFacts, body: string | null): Promise<Evidence> {
  const { accountId } = facts;
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.senderHash, hashOf(db, facts.from.address)), lte(messages.receivedAt, facts.receivedAt)));
  const [written] = await db
    .select({ yes: correspondents.userHasWritten })
    .from(correspondents)
    .where(and(eq(correspondents.accountId, accountId), eq(correspondents.addressHash, hashOf(db, facts.from.address))));
  return {
    facts,
    known: deriveFacts(facts, {}, await mailboxAliases(db, accountId)),
    body,
    sender: {
      messagesSeen: Math.max(1, n),
      userHasWritten: written?.yes ?? null,
    },
  };
}

/**
 * Start replaying the model over an account's stored examples: record the run with the examples it will
 * judge, newest answers first, and return its id. `continueEval` judges them. Only one run at a time.
 * Throws with a message for the user if there is nothing to run.
 */
export async function startEval(deps: Pick<EvalDeps, 'db' | 'model' | 'now'>, request: EvalRequest): Promise<number> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  if ((await goingEvals(db)).length > 0) throw new Refusal('A test run is already going. Wait for it to finish.');
  const limit = Math.min(Math.max(1, Math.trunc(request.limit ?? DEFAULT_EVAL_EXAMPLES)), MAX_EVAL_EXAMPLES);
  const examples = await db
    .select({ messageId: exampleRows.messageId })
    .from(exampleRows)
    .where(and(eq(exampleRows.accountId, request.accountId), eq(exampleRows.status, 'captured'), isNotNull(exampleRows.labelId)))
    .orderBy(desc(exampleRows.markedAt), exampleRows.messageId)
    .limit(limit);
  if (examples.length === 0) throw new Refusal('There are no stored examples to test against yet. Answer some mail in For review first.');

  const shown = (await listLabels(db)).map((l) => ({ id: l.id, name: l.name, description: l.description }));
  const [{ id }] = (await db
    .insert(evalRuns)
    .values({
      accountId: request.accountId,
      startedAt: now(),
      status: 'running',
      model: deps.model,
      promptHash: hash(PROMPT_TEMPLATE),
      labelsHash: hash(JSON.stringify(shown)),
      labels: shown,
      fewShot: request.fewShot,
      total: examples.length,
      examples: examples.map((e) => e.messageId),
    })
    .returning({ id: evalRuns.id })) as [{ id: number }];
  return id;
}

/** Runs still going: each tick judges the next slice of each. */
export async function goingEvals(db: Sql): Promise<number[]> {
  return (await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.status, 'running'))).map((r) => r.id);
}

/**
 * Judge what is left of a run, a few calls at a time, starting none after `until`; each result is stored
 * as it arrives. Finishes the run when nothing is left, or when it cannot go on (its model is no longer
 * the one in use). True when the run is over.
 */
export async function continueEval(deps: EvalDeps, runId: number, until: number): Promise<boolean> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId));
  if (run?.status !== 'running') return true;
  const finish = async (status: 'done' | 'failed', error: string | null) => {
    await db.update(evalRuns).set({ status, error, finishedAt: now() }).where(eq(evalRuns.id, runId));
    return true;
  };
  if (run.model !== deps.model) return await finish('failed', `The model changed to ${deps.model} during the run.`);

  const judged = new Set((await db.select({ id: evalResults.messageId }).from(evalResults).where(eq(evalResults.runId, runId))).map((r) => r.id));
  const left = run.examples.filter((id) => !judged.has(id));
  const labels = await listLabels(db);

  const judgeOne = async (messageId: string) => {
    const [example] = await db
      .select({ labelId: exampleRows.labelId, bodyText: exampleRows.bodyText })
      .from(exampleRows)
      .where(and(eq(exampleRows.accountId, run.accountId), eq(exampleRows.messageId, messageId)));
    const facts = await getFacts(db, run.accountId, messageId);
    // Deleted since the run started.
    if (!example?.labelId || !facts) return;
    // Only what had been answered when the message arrived, as new mail would have had. Answers given later,
    // often in one go for a sender's waiting mail, would show the model the answer to a message just like it.
    const shots = run.fewShot ? await examplesFor(db, facts, labels, facts.receivedAt) : [];
    const started = performance.now();
    const evidence = await storedEvidence(db, facts, plain(openPart(db, run.accountId, messageId, 'text', example.bodyText)));
    // A conversation per message of the run, named by where it is in the run rather than by the message.
    const answer = await invokeAgent(
      'eval',
      [db.person, runId, run.examples.indexOf(messageId)],
      { 'sift.eval_run': runId, ...traceIds(db, messageId, facts.from) },
      () =>
        deps
          .judge({ evidence, labels, ...(shots.length > 0 ? { examples: shots } : {}) })
          .catch((error: unknown): JudgeFailure => ({ failed: describeFailure(error) })),
    );
    // An unusable answer was still billed.
    const verdict = 'failed' in answer ? null : answer;
    await db
      .insert(evalResults)
      .values({
        runId,
        messageId,
        expected: example.labelId,
        got: verdict?.label ?? null,
        error: 'failed' in answer ? answer.failed : null,
        confidence: verdict?.confidence ?? null,
        inputTokens: answer.usage?.inputTokens ?? 0,
        outputTokens: answer.usage?.outputTokens ?? 0,
        costUsd: answer.usage?.costUsd ?? 0,
        durationMs: Math.round(performance.now() - started),
        shots: shots.length,
        senderShots: shots.filter((s) => s.fromAddress === facts.from.address).length,
      })
      .onConflictDoNothing();
  };

  let next = 0;
  const worker = async () => {
    while (next < left.length && now() < until) await judgeOne(left[next++]!);
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (error) {
    return await finish('failed', error instanceof Error ? error.message : String(error));
  }
  return next < left.length ? false : await finish('done', null);
}

export interface EvalRun {
  id: number;
  accountId: string;
  startedAt: number;
  finishedAt: number | null;
  status: (typeof EVAL_STATUSES)[number];
  error: string | null;
  /** What it ran with. Two runs with the same values here differ only by chance and by the examples stored since. */
  model: string;
  promptHash: string;
  labelsHash: string;
  labels: { id: string; name: string; description: string }[];
  fewShot: boolean;
  /** Examples in the run. `score.total` is how many have been judged so far. */
  total: number;
  score: Scorecard;
  /**
   * Of the answers, those given with an example from the same sender in the prompt: how much of the score is
   * senders the user had already answered for, which are easier than a new one.
   */
  withSenderExample: { answered: number; right: number };
}

interface EvalResult {
  messageId: string;
  fromAddress: Confidential;
  subject: Confidential;
  expected: string;
  got: string | null;
  /** Why the call failed, when `got` is null. */
  error: string | null;
  confidence: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  shots: number;
  senderShots: number;
}

const RUN = {
  id: evalRuns.id,
  accountId: evalRuns.accountId,
  startedAt: evalRuns.startedAt,
  finishedAt: evalRuns.finishedAt,
  status: evalRuns.status,
  error: evalRuns.error,
  model: evalRuns.model,
  promptHash: evalRuns.promptHash,
  labelsHash: evalRuns.labelsHash,
  labels: evalRuns.labels,
  fewShot: evalRuns.fewShot,
  total: evalRuns.total,
};

async function results(db: Sql, runId: number): Promise<EvalResult[]> {
  const rows = await db
    .select({
      accountId: evalRuns.accountId,
      messageId: evalResults.messageId,
      headers: messages.headers,
      expected: evalResults.expected,
      got: evalResults.got,
      error: evalResults.error,
      confidence: evalResults.confidence,
      inputTokens: evalResults.inputTokens,
      outputTokens: evalResults.outputTokens,
      costUsd: evalResults.costUsd,
      durationMs: evalResults.durationMs,
      shots: evalResults.shots,
      senderShots: evalResults.senderShots,
    })
    .from(evalResults)
    .innerJoin(evalRuns, eq(evalRuns.id, evalResults.runId))
    .leftJoin(messages, and(eq(messages.accountId, evalRuns.accountId), eq(messages.id, evalResults.messageId)))
    .where(eq(evalResults.runId, runId))
    .orderBy(evalResults.messageId);
  return rows.map(({ accountId, ...r }) => {
    const opened = openEnvelope(db, accountId, r.messageId, r);
    return { ...opened, fromAddress: opened.fromAddress ?? seal<string>(''), subject: opened.subject ?? seal<string>('') };
  });
}

function toRun(row: Omit<EvalRun, 'score' | 'withSenderExample'>, judged: readonly EvalResult[]): EvalRun {
  const helped = judged.filter((r) => r.senderShots > 0 && r.got !== null);
  return {
    ...row,
    score: score(judged),
    withSenderExample: { answered: helped.length, right: helped.filter((r) => r.got === r.expected).length },
  };
}

/** Past runs with their scores, newest first. */
export async function listEvalRuns(db: Sql, limit = 50): Promise<EvalRun[]> {
  const rows = await db.select(RUN).from(evalRuns).orderBy(desc(evalRuns.id)).limit(limit);
  return await Promise.all(rows.map(async (row) => toRun(row, await results(db, row.id))));
}

/** One run with what the model said for each example, or null if there is no such run. */
export async function getEvalRun(db: Sql, id: number): Promise<{ run: EvalRun; results: EvalResult[] } | null> {
  const [row] = await db.select(RUN).from(evalRuns).where(eq(evalRuns.id, id));
  if (!row) return null;
  const judged = await results(db, id);
  return { run: toRun(row, judged), results: judged };
}
