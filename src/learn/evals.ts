import { createHash } from 'node:crypto';
import {
  alias,
  and,
  correspondents,
  count,
  decisions,
  desc,
  eq,
  evalResults,
  evalRuns,
  examples as exampleRows,
  isNotNull,
  lt,
  lte,
  max,
  messages,
  min,
  ne,
  sql,
} from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
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
  db: Sql;
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
async function storedEvidence(db: Sql, facts: MessageFacts, body: string | null): Promise<Evidence> {
  const { accountId, messageId } = facts;
  const [{ first } = { first: null }] = await db
    .select({ first: min(decisions.id) })
    .from(decisions)
    .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, messageId)));
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.fromAddress, facts.from.address), lte(messages.receivedAt, facts.receivedAt)));
  const x = alias(decisions, 'x');
  const past = await db
    .select({ disposition: decisions.disposition, n: count() })
    .from(decisions)
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .where(
      and(
        eq(decisions.accountId, accountId),
        eq(messages.fromAddress, facts.from.address),
        ne(decisions.messageId, messageId),
        eq(
          decisions.id,
          db
            .select({ id: max(x.id) })
            .from(x)
            .where(and(eq(x.accountId, decisions.accountId), eq(x.messageId, decisions.messageId), lt(x.id, first ?? 0))),
        ),
      ),
    )
    .groupBy(decisions.disposition);
  const [written] = await db
    .select({ yes: correspondents.userHasWritten })
    .from(correspondents)
    .where(and(eq(correspondents.accountId, accountId), eq(correspondents.address, facts.from.address)));
  return {
    facts,
    known: deriveFacts(facts),
    body,
    sender: {
      messagesSeen: Math.max(1, n),
      userHasWritten: written ? written.yes === 1 : null,
      pastDispositions: Object.fromEntries(past.map((r) => [r.disposition as Disposition, r.n])),
    },
  };
}

/**
 * Start replaying the model over an account's stored examples, and return at once with the run's id.
 * The run goes on in the background, a few calls at a time; each result is stored as it arrives.
 * `done` resolves when it has finished and never rejects. Only one run at a time. Throws with a
 * message for the user if there is nothing to run.
 */
export async function startEval(deps: EvalDeps, request: EvalRequest): Promise<{ id: number; done: Promise<void> }> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  if ((await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.status, 'running')).limit(1)).length > 0)
    throw new Error('A test run is already going. Wait for it to finish.');
  const labels = await listLabels(db, request.accountId, now());
  const limit = Math.min(Math.max(1, Math.trunc(request.limit ?? DEFAULT_EVAL_EXAMPLES)), MAX_EVAL_EXAMPLES);
  // An example whose label has since gone cannot be answered correctly, so it is left out.
  const examples = (
    await db
      .select({ messageId: exampleRows.messageId, labelId: exampleRows.labelId, bodyText: exampleRows.bodyText })
      .from(exampleRows)
      .where(and(eq(exampleRows.accountId, request.accountId), eq(exampleRows.status, 'captured'), isNotNull(exampleRows.labelId)))
      .orderBy(desc(exampleRows.markedAt), exampleRows.messageId)
  )
    .filter((e): e is typeof e & { labelId: string } => labels.some((l) => l.id === e.labelId))
    .slice(0, limit);
  if (examples.length === 0) throw new Error('There are no stored examples to test against yet. Answer some suggestions first.');

  const shown = labels.map((l) => ({ id: l.id, name: l.name, description: l.description }));
  const [{ id }] = (await db
    .insert(evalRuns)
    .values({
      accountId: request.accountId,
      startedAt: now(),
      status: 'running',
      model: deps.model,
      promptHash: hash(PROMPT_TEMPLATE),
      guidelinesHash: hash(deps.guidelines.trim()),
      labelsHash: hash(JSON.stringify(shown)),
      labelsJson: JSON.stringify(shown),
      fewShot: request.fewShot ? 1 : 0,
      total: examples.length,
    })
    .returning({ id: evalRuns.id })) as [{ id: number }];

  const judgeOne = async (example: (typeof examples)[number], labels: readonly Label[]) => {
    const facts = await getFacts(db, request.accountId, example.messageId);
    if (!facts) return;
    // `pickShots` leaves out the message itself, so an example is never shown its own answer.
    const shots = request.fewShot ? pickShots(await shotCandidates(db, facts), facts, labels) : [];
    const started = performance.now();
    const verdict = await deps
      .judge({
        evidence: await storedEvidence(db, facts, example.bodyText),
        labels,
        guidelines: deps.guidelines,
        ...(shots.length > 0 ? { examples: shots } : {}),
      })
      .catch(() => null);
    await db.insert(evalResults).values({
      runId: id,
      messageId: example.messageId,
      expected: example.labelId,
      got: verdict?.label ?? null,
      confidence: verdict?.confidence ?? null,
      inputTokens: verdict?.usage?.inputTokens ?? 0,
      outputTokens: verdict?.usage?.outputTokens ?? 0,
      costUsd: verdict?.usage?.costUsd ?? 0,
      durationMs: Math.round(performance.now() - started),
      shots: shots.length,
      senderShots: shots.filter((s) => s.fromAddress === facts.from.address).length,
    });
  };

  let next = 0;
  const worker = async () => {
    while (next < examples.length) await judgeOne(examples[next++]!, labels);
  };
  const finish = async (status: 'done' | 'failed', error: string | null) => {
    await db.update(evalRuns).set({ status, error, finishedAt: now() }).where(eq(evalRuns.id, id));
  };
  const done = Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(
    () => finish('done', null),
    (error: unknown) => finish('failed', error instanceof Error ? error.message : String(error)),
  );
  return { id, done };
}

/** Call when sift starts: a run still marked as going belongs to a process that has stopped. */
export async function interruptEvals(db: Sql, now: number = Date.now()): Promise<void> {
  await db.update(evalRuns).set({ status: 'interrupted', finishedAt: now }).where(eq(evalRuns.status, 'running'));
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

const RUN = {
  id: evalRuns.id,
  accountId: evalRuns.accountId,
  startedAt: evalRuns.startedAt,
  finishedAt: evalRuns.finishedAt,
  status: sql<EvalRun['status']>`${evalRuns.status}`,
  error: evalRuns.error,
  model: evalRuns.model,
  promptHash: evalRuns.promptHash,
  guidelinesHash: evalRuns.guidelinesHash,
  labelsHash: evalRuns.labelsHash,
  labelsJson: evalRuns.labelsJson,
  fewShot: evalRuns.fewShot,
  total: evalRuns.total,
};

async function results(db: Sql, runId: number): Promise<EvalResult[]> {
  return await db
    .select({
      messageId: evalResults.messageId,
      fromAddress: sql<string>`coalesce(${messages.fromAddress}, '')`,
      subject: sql<string>`coalesce(${messages.subject}, '')`,
      expected: evalResults.expected,
      got: evalResults.got,
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
}

function toRun(
  { labelsJson, fewShot, ...row }: Omit<EvalRun, 'labels' | 'fewShot' | 'score' | 'withSenderExample'> & { labelsJson: string; fewShot: number },
  judged: readonly EvalResult[],
): EvalRun {
  const helped = judged.filter((r) => r.senderShots > 0 && r.got !== null);
  return {
    ...row,
    labels: JSON.parse(labelsJson) as EvalRun['labels'],
    fewShot: fewShot === 1,
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
