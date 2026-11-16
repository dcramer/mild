import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_EVAL_EXAMPLES, getEvalRun, interruptEvals, listEvalRuns, startEval } from '../src/learn/evals.ts';
import { addMailbox, recordSync } from '../src/store/accounts.ts';
import { openUserDb, raw } from './fixtures.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { updateLabel } from '../src/store/labels.ts';
import { rememberCorrespondent } from '../src/store/senders.ts';
import { score } from '../src/triage/score.ts';
import type { JudgeFailure, JudgeInput, Verdict } from '../src/triage/stages/model.ts';
import { facts, storeExample } from './helpers.ts';

const ACCOUNT = 'me@example.org';
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
  const deps = (answers: Record<string, string>) => ({
    db,
    judge: judge(answers),
    model: 'test/model',
    now: () => 500,
  });

  beforeEach(async () => {
    db = await openUserDb(ACCOUNT);
    await addMailbox(db, ACCOUNT, '1', 0);
    seen = [];
    await storeExample(db, ACCOUNT, { id: 'e1', from: 'news@example.com', label: 'newsletter', body: 'Issue 12.', markedAt: 1 });
    await storeExample(db, ACCOUNT, { id: 'e2', from: 'news@example.com', label: 'newsletter', markedAt: 2 });
    await storeExample(db, ACCOUNT, { id: 'e3', from: 'sales@example.org', label: 'marketing', markedAt: 3 });
    await storeExample(db, ACCOUNT, { id: 'e4', from: 'ada@example.org', label: 'personal', markedAt: 4 });
  });

  it('judges each example, stores every result and reports the score with what it ran with', async () => {
    const { id, done } = await startEval(deps({ e1: 'newsletter', e2: 'marketing', e3: 'unsure' }), { accountId: ACCOUNT, fewShot: false });
    expect((await listEvalRuns(db))[0]).toMatchObject({ id, status: 'running', total: 4 });
    await done;

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

  it('shows the other examples when asked, never the one under test, and says how many answers had the sender to go on', async () => {
    const { id, done } = await startEval(deps({ e1: 'newsletter', e2: 'newsletter', e3: 'marketing', e4: 'newsletter' }), {
      accountId: ACCOUNT,
      fewShot: true,
    });
    await done;
    for (const input of seen) {
      expect(input.examples?.length).toBeGreaterThan(0);
      expect(input.examples?.map((s) => s.messageId)).not.toContain(input.evidence.facts.messageId);
    }
    expect(seen.find((s) => s.evidence.facts.messageId === 'e1')?.examples?.[0]?.messageId).toBe('e2');
    const { run, results } = (await getEvalRun(db, id))!;
    expect(run.fewShot).toBe(true);
    expect(results.find((r) => r.messageId === 'e1')).toMatchObject({ shots: 3, senderShots: 1 });
    expect(run.withSenderExample).toEqual({ answered: 2, right: 2 });
  });

  it('rebuilds the sender history as it stood when the message arrived, without what the answer changed', async () => {
    const news = { address: 'list@example.com', domain: 'example.com' };
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'old', from: news, receivedAt: 10 })], '3');
    await recordSync(
      db,
      ACCOUNT,
      [facts({ accountId: ACCOUNT, messageId: 'judged', from: news, receivedAt: 20, headers: { 'list-id': '<l.example.com>' } })],
      '4',
    );
    await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'later', from: news, receivedAt: 30 })], '5');
    const agent = { subscription: 'preserve', stage: 'model', reason: 'r' } as const;
    await recordDecision(db, ACCOUNT, 'old', { ...agent, disposition: 'archive' });
    await recordDecision(db, ACCOUNT, 'judged', { ...agent, disposition: 'review' });
    // After the user answered: the earlier message was corrected and a later one arrived.
    await recordDecision(db, ACCOUNT, 'old', { ...agent, stage: 'rules', disposition: 'keep' });
    await recordDecision(db, ACCOUNT, 'later', { ...agent, stage: 'rules', disposition: 'keep' });
    await raw(db).run(
      `INSERT INTO examples (account_id, message_id, disposition, label_id, marked_at, status, body_text)
       VALUES (?, 'judged', 'keep', 'personal', 9, 'captured', 'Hello.')`,
      ACCOUNT,
    );
    await rememberCorrespondent(db, ACCOUNT, news.address, true);

    await (
      await startEval(deps({}), { accountId: ACCOUNT, fewShot: false, limit: 1 })
    ).done;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.evidence).toMatchObject({
      facts: { messageId: 'judged', from: news },
      known: { listId: 'l.example.com' },
      body: 'Hello.',
      sender: { messagesSeen: 2, userHasWritten: true, pastDispositions: { archive: 1 } },
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
    await (
      await startEval({ db, judge: slow, model: 'test/model' }, { accountId: ACCOUNT, fewShot: false, limit: 10 })
    ).done;
    expect(seen.map((s) => s.evidence.facts.messageId).toSorted()).toEqual(['x10', 'x11', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9']);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);

    seen = [];
    for (let i = 0; i < MAX_EVAL_EXAMPLES; i++) await storeExample(db, ACCOUNT, { id: `y${i}`, from: `y${i}@example.org`, label: 'personal', markedAt: 900 });
    await (
      await startEval(deps({}), { accountId: ACCOUNT, fewShot: false, limit: 100_000 })
    ).done;
    expect(seen).toHaveLength(MAX_EVAL_EXAMPLES);
  });

  it('runs one at a time, and only when there is something to run', async () => {
    const first = await startEval(deps({}), { accountId: ACCOUNT, fewShot: false });
    await expect(startEval(deps({}), { accountId: ACCOUNT, fewShot: false })).rejects.toThrow('already going');
    await first.done;
    await (
      await startEval(deps({}), { accountId: ACCOUNT, fewShot: false })
    ).done;
    expect((await listEvalRuns(db)).map((r) => r.status)).toEqual(['done', 'done']);

    await raw(db).run('DELETE FROM examples');
    await expect(startEval(deps({}), { accountId: ACCOUNT, fewShot: false })).rejects.toThrow('no stored examples');
  });

  it('counts a judge that throws as a failed call, and keeps why as a status and kind, not what the provider said', async () => {
    const throwing = async () => {
      throw Object.assign(new Error('503 upstream: cannot read "Your invoice from example.com"'), { status: 503 });
    };
    const { id, done } = await startEval({ db, judge: throwing, model: 'test/model' }, { accountId: ACCOUNT, fewShot: false });
    await done;
    const { run, results } = (await getEvalRun(db, id))!;
    expect(run).toMatchObject({ status: 'done', total: 4, score: { total: 4, failed: 4 } });
    expect(new Set(results.map((r) => r.error))).toEqual(new Set(['HTTP 503 unavailable']));
  });

  it('keeps the cost of a call that was billed but answered unusably', async () => {
    const unusable = async (): Promise<JudgeFailure> => ({ failed: 'the model did not return a usable verdict', usage });
    const { id, done } = await startEval({ db, judge: unusable, model: 'test/model' }, { accountId: ACCOUNT, fewShot: false });
    await done;
    const { run, results } = (await getEvalRun(db, id))!;
    expect(run.score).toMatchObject({ failed: 4, costUsd: 0.004, inputTokens: 4000 });
    expect(results.every((r) => r.got === null && r.costUsd === 0.001 && r.error === 'the model did not return a usable verdict')).toBe(true);
  });

  it('records settings that tell two runs apart', async () => {
    await (
      await startEval(deps({}), { accountId: ACCOUNT, fewShot: false })
    ).done;
    await (
      await startEval(deps({}), { accountId: ACCOUNT, fewShot: false })
    ).done;
    await updateLabel(db, ACCOUNT, 'newsletter', { description: 'Anything sent to a list.' });
    await (
      await startEval(deps({}), { accountId: ACCOUNT, fewShot: false })
    ).done;
    const [c, b, a] = await listEvalRuns(db);
    expect(a?.promptHash).toMatch(/^[0-9a-f]{12}$/);
    expect(new Set([a?.promptHash, b?.promptHash, c?.promptHash]).size).toBe(1);
    expect(b?.labelsHash).toBe(a?.labelsHash);
    expect(c?.labelsHash).not.toBe(b?.labelsHash);
    expect(c?.labels.find((l) => l.id === 'newsletter')?.description).toBe('Anything sent to a list.');
  });

  it('marks a run that was going when sift stopped', async () => {
    await startEval({ db, judge: () => new Promise(() => {}), model: 'test/model' }, { accountId: ACCOUNT, fewShot: false });
    await interruptEvals(db, 900);
    expect((await listEvalRuns(db))[0]).toMatchObject({ status: 'interrupted', finishedAt: 900 });
    expect(await getEvalRun(db, 999)).toBeNull();
  });
});
