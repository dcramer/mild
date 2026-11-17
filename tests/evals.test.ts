import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_EVAL_EXAMPLES, type EvalRequest, continueEval, getEvalRun, listEvalRuns, startEval } from '../src/learn/evals.ts';
import { recordSync } from '../src/store/accounts.ts';
import { openUserDb, raw } from './fixtures.ts';
import { updateLabel } from '../src/store/labels.ts';
import { rememberCorrespondent } from '../src/store/senders.ts';
import { score } from '../src/triage/score.ts';
import type { JudgeFailure, JudgeInput, Verdict } from '../src/triage/stages/model.ts';
import { ACCOUNT, facts, storeExample, testModel } from './helpers.ts';

const free = { costUsd: 0, inputTokens: 0, outputTokens: 0 };

describe('scoring', () => {
  it('counts right, wrong, unsure and failed overall and per label, and lists what was mixed up', () => {
    const card = score([
      { expected: 'newsletter', got: 'newsletter', costUsd: 0.002, inputTokens: 900, outputTokens: 20 },
      { expected: 'newsletter', got: 'marketing', costUsd: 0.002, inputTokens: 1100, outputTokens: 20 },
      { expected: 'newsletter', got: 'marketing', ...free },
      { expected: 'marketing', got: 'newsletter', ...free },
      { expected: 'personal', got: 'unsure', ...free },
      { expected: 'personal', got: null, ...free },
    ]);
    expect(card).toMatchObject({ total: 6, right: 1, wrong: 3, unsure: 1, failed: 1, costUsd: 0.004, inputTokens: 2000, outputTokens: 40 });
    expect(card.byLabel).toEqual([
      { labelId: 'newsletter', total: 3, right: 1, wrong: 2, unsure: 0, failed: 0 },
      { labelId: 'personal', total: 2, right: 0, wrong: 0, unsure: 1, failed: 1 },
      { labelId: 'marketing', total: 1, right: 0, wrong: 1, unsure: 0, failed: 0 },
    ]);
    expect(card.confusion).toEqual([
      { expected: 'newsletter', got: 'marketing', count: 2 },
      { expected: 'marketing', got: 'newsletter', count: 1 },
    ]);
    // Averaged over the five calls that answered.
    expect(card.perMessage).toEqual({ costUsd: 0.0008, inputTokens: 400, outputTokens: 8 });
  });

  it('copes with nothing judged', () => {
    expect(score([])).toMatchObject({ total: 0, right: 0, byLabel: [], confusion: [], perMessage: { costUsd: 0 } });
  });
});

describe('replaying the model over stored examples', () => {
  let db: Sql;
  let seen: JudgeInput[];
  const usage = { model: 'test/model', inputTokens: 1000, outputTokens: 10, costUsd: 0.001 };
  /** A judge that answers from a table of message id to label; a missing entry is a failed call. */
  const judge =
    (answers: Record<string, string>) =>
    async (input: JudgeInput): Promise<Verdict | JudgeFailure> => {
      seen.push(input);
      const label = answers[input.evidence.facts.messageId];
      return label === undefined ? { failed: 'provider error' } : { label, reason: 'r', confidence: 0.8, usage };
    };
  const deps = (answers: Record<string, string>) => ({ db, ...testModel(judge(answers)), now: () => 500 });
  /** Start a run and carry it to its end, as its jobs would. */
  const runEval = async (given: Parameters<typeof continueEval>[0], request: EvalRequest) => {
    const id = await startEval(given, request);
    while (!(await continueEval(given, id, Infinity)));
    return id;
  };

  beforeEach(async () => {
    db = await openUserDb(ACCOUNT);
    seen = [];
    // Each arrives, then is answered before the next arrives.
    await storeExample(db, ACCOUNT, { id: 'e1', from: 'news@example.com', label: 'newsletter', body: 'Issue 12.', receivedAt: 10, markedAt: 11 });
    await storeExample(db, ACCOUNT, { id: 'e2', from: 'news@example.com', label: 'newsletter', receivedAt: 20, markedAt: 21 });
    await storeExample(db, ACCOUNT, { id: 'e3', from: 'sales@example.org', label: 'marketing', receivedAt: 30, markedAt: 31 });
    await storeExample(db, ACCOUNT, { id: 'e4', from: 'ada@example.org', label: 'personal', receivedAt: 40, markedAt: 41 });
  });

  it('judges each example, stores every result and reports the score with what it ran with', async () => {
    const given = deps({ e1: 'newsletter', e2: 'marketing', e3: 'unsure' });
    const id = await startEval(given, { accountId: ACCOUNT, fewShot: false });
    expect((await listEvalRuns(db))[0]).toMatchObject({ id, status: 'running', total: 4 });
    expect(await continueEval(given, id, Infinity)).toBe(true);

    const { run, results } = (await getEvalRun(db, id))!;
    expect(run).toMatchObject({ status: 'done', startedAt: 500, finishedAt: 500, model: 'test/model', fewShot: false, total: 4, accountId: ACCOUNT });
    expect(run.score).toMatchObject({ total: 4, right: 1, wrong: 1, unsure: 1, failed: 1, costUsd: 0.003, inputTokens: 3000, outputTokens: 30 });
    expect(run.score.confusion).toEqual([{ expected: 'newsletter', got: 'marketing', count: 1 }]);
    expect(run.labels.map((l) => l.id)).toContain('newsletter');
    expect(results.map((r) => [r.messageId, r.expected, r.got, r.costUsd, r.shots])).toEqual([
      ['e1', 'newsletter', 'newsletter', 0.001, 0],
      ['e2', 'newsletter', 'marketing', 0.001, 0],
      ['e3', 'marketing', 'unsure', 0.001, 0],
      ['e4', 'personal', null, 0, 0],
    ]);
    expect(results[0]).toMatchObject({ fromAddress: 'news@example.com', subject: 'Subject e1', confidence: 0.8 });
    expect(seen.every((s) => s.examples === undefined)).toBe(true);
    expect(seen.find((s) => s.evidence.facts.messageId === 'e1')?.evidence.body).toBe('Issue 12.');
  });

  it('shows only the examples answered before the message arrived, and says how many answers had the sender to go on', async () => {
    const id = await runEval(deps({ e1: 'newsletter', e2: 'newsletter', e3: 'marketing', e4: 'newsletter' }), {
      accountId: ACCOUNT,
      fewShot: true,
    });
    const shown = Object.fromEntries(seen.map((s) => [s.evidence.facts.messageId, s.examples?.map((e) => e.messageId) ?? []]));
    expect(shown).toEqual({ e1: [], e2: ['e1'], e3: ['e2'], e4: ['e3', 'e2'] });
    const { run, results } = (await getEvalRun(db, id))!;
    expect(run.fewShot).toBe(true);
    expect(results.find((r) => r.messageId === 'e2')).toMatchObject({ shots: 1, senderShots: 1 });
    expect(run.withSenderExample).toEqual({ answered: 1, right: 1 });
  });

  it('counts the mail the sender had sent when the message arrived, not what came after', async () => {
    const news = { address: 'list@example.com', domain: 'example.com' };
    await recordSync(db, ACCOUNT, [facts({ messageId: 'old', from: news, receivedAt: 10 })], '3');
    await recordSync(db, ACCOUNT, [facts({ messageId: 'judged', from: news, receivedAt: 20, headers: { 'list-id': '<l.example.com>' } })], '4');
    await recordSync(db, ACCOUNT, [facts({ messageId: 'later', from: news, receivedAt: 30 })], '5');
    await raw(db).run(
      `INSERT INTO examples (account_id, message_id, label_id, marked_at, status, body_text)
       VALUES (?, 'judged', 'personal', 99, 'captured', 'Hello.')`,
      ACCOUNT,
    );
    await rememberCorrespondent(db, ACCOUNT, news.address, true);

    await runEval(deps({}), { accountId: ACCOUNT, fewShot: false, limit: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.evidence).toMatchObject({
      facts: { messageId: 'judged', from: news },
      known: { listId: 'l.example.com' },
      body: 'Hello.',
      sender: { messagesSeen: 2, userHasWritten: true },
    });
  });

  it('judges at most the cap, newest answers first, a few at a time', async () => {
    for (let i = 0; i < 12; i++) await storeExample(db, ACCOUNT, { id: `x${i}`, from: `s${i}@example.org`, label: 'personal', markedAt: 100 + i });
    let running = 0;
    let most = 0;
    const slow = async (input: JudgeInput) => {
      seen.push(input);
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running--;
      return { label: 'personal', reason: 'r' };
    };
    await runEval({ db, ...testModel(slow) }, { accountId: ACCOUNT, fewShot: false, limit: 10 });
    expect(seen.map((s) => s.evidence.facts.messageId).toSorted()).toEqual(['x10', 'x11', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9']);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);

    seen = [];
    for (let i = 0; i < MAX_EVAL_EXAMPLES; i++) await storeExample(db, ACCOUNT, { id: `y${i}`, from: `y${i}@example.org`, label: 'personal', markedAt: 900 });
    await runEval(deps({}), { accountId: ACCOUNT, fewShot: false, limit: 100_000 });
    expect(seen).toHaveLength(MAX_EVAL_EXAMPLES);
  });

  it('runs one at a time, and only when there is something to run', async () => {
    const first = await startEval(deps({}), { accountId: ACCOUNT, fewShot: false });
    await expect(startEval(deps({}), { accountId: ACCOUNT, fewShot: false })).rejects.toThrow('already going');
    await continueEval(deps({}), first, Infinity);
    await runEval(deps({}), { accountId: ACCOUNT, fewShot: false });
    expect((await listEvalRuns(db)).map((r) => r.status)).toEqual(['done', 'done']);

    await raw(db).run('DELETE FROM examples');
    await expect(startEval(deps({}), { accountId: ACCOUNT, fewShot: false })).rejects.toThrow('no stored examples');
  });

  it('counts a judge that throws as a failed call, and keeps why as a status and kind, not what the provider said', async () => {
    const throwing = async () => {
      throw Object.assign(new Error('503 upstream: cannot read "Your invoice from example.com"'), { status: 503 });
    };
    const id = await runEval({ db, ...testModel(throwing) }, { accountId: ACCOUNT, fewShot: false });
    const { run, results } = (await getEvalRun(db, id))!;
    expect(run).toMatchObject({ status: 'done', total: 4, score: { total: 4, failed: 4 } });
    expect(new Set(results.map((r) => r.error))).toEqual(new Set(['HTTP 503 unavailable']));
  });

  it('keeps the cost of a call that was billed but answered unusably', async () => {
    const unusable = async (): Promise<JudgeFailure> => ({ failed: 'the model did not return a usable verdict', usage });
    const id = await runEval({ db, ...testModel(unusable) }, { accountId: ACCOUNT, fewShot: false });
    const { run, results } = (await getEvalRun(db, id))!;
    expect(run.score).toMatchObject({ failed: 4, costUsd: 0.004, inputTokens: 4000 });
    expect(results.every((r) => r.got === null && r.costUsd === 0.001 && r.error === 'the model did not return a usable verdict')).toBe(true);
  });

  it('records settings that tell two runs apart', async () => {
    await runEval(deps({}), { accountId: ACCOUNT, fewShot: false });
    await runEval(deps({}), { accountId: ACCOUNT, fewShot: false });
    await updateLabel(db, ACCOUNT, 'newsletter', { description: 'Anything sent to a list.' });
    await runEval(deps({}), { accountId: ACCOUNT, fewShot: false });
    const [c, b, a] = await listEvalRuns(db);
    expect(a?.promptHash).toMatch(/^[0-9a-f]{12}$/);
    expect(new Set([a?.promptHash, b?.promptHash, c?.promptHash]).size).toBe(1);
    expect(b?.labelsHash).toBe(a?.labelsHash);
    expect(c?.labelsHash).not.toBe(b?.labelsHash);
    expect(c?.labels.find((l) => l.id === 'newsletter')?.description).toBe('Anything sent to a list.');
  });

  it('stops at its time limit and carries on where it stopped, judging nothing twice', async () => {
    for (let i = 0; i < 6; i++) await storeExample(db, ACCOUNT, { id: `x${i}`, from: `s${i}@example.org`, label: 'personal', markedAt: 100 + i });
    let clock = 0;
    // Each call takes a second.
    const given = { db, ...testModel(async (input) => (seen.push(input), (clock += 1000), { label: 'personal', reason: 'r' })), now: () => clock };
    const id = await startEval(given, { accountId: ACCOUNT, fewShot: false });
    expect(await continueEval(given, id, 1500)).toBe(false);
    expect(seen.length).toBeLessThan(10);
    expect(await continueEval(given, id, Infinity)).toBe(true);
    expect(new Set(seen.map((s) => s.evidence.facts.messageId)).size).toBe(10);
    expect(seen).toHaveLength(10);
    expect((await getEvalRun(db, id))?.run).toMatchObject({ status: 'done', total: 10 });
    expect(await getEvalRun(db, 999)).toBeNull();
  });

  it('fails a run whose model changed under it', async () => {
    const id = await startEval(deps({}), { accountId: ACCOUNT, fewShot: false });
    expect(await continueEval({ ...deps({}), model: 'other/model' }, id, Infinity)).toBe(true);
    expect((await listEvalRuns(db))[0]).toMatchObject({ status: 'failed' });
  });
});
