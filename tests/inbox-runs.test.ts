import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { continueInboxRun } from '../src/work/inbox-runs.ts';
import { goingInboxRuns, inboxProgress, modelShare, startInboxRuns, stopInboxRuns } from '../src/store/inbox-runs.ts';
import { averageCall } from '../src/store/runs.ts';
import { triageAccount } from '../src/work/triage.ts';
import { recordSync } from '../src/store/messages.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { setActive } from '../src/store/preferences.ts';
import { addRule } from '../src/store/rules.ts';
import { ACCOUNT, UNSURE, facts, testModel } from './helpers.ts';
import { connectGmail, fakeGoogle, firstAccount, modelRun, raw, onePerson } from './fixtures.ts';

const fake = fakeGoogle();
let db: Sql;

beforeEach(async () => {
  ({ db } = await onePerson(ACCOUNT));
});

describe('going through the inbox', () => {
  const unsure = async () => UNSURE;
  let gmail: ReturnType<typeof connectGmail>;
  let asked: string[];
  beforeEach(() => {
    gmail = connectGmail(fake.google);
    asked = [];
  });
  /** Mail from news@example.com that was in the inbox before Mild, newest first. */
  const inGmail = (...ids: string[]) =>
    ids.forEach((id, i) => gmail.gmail.deliver({ id, from: 'News <news@example.com>', to: ACCOUNT, at: Date.UTC(2026, 0, 1) - i }, { quietly: true }));
  /** The page of the inbox each search asked Gmail for. */
  const listed = () =>
    gmail.gmail
      .asked('users.messages.list')
      .filter((r) => !r.q)
      .map((r) => r.pageToken ?? '');
  /** One piece of work on the run, with Mild on or off; the model is `judge`. */
  const goOn = async (run: number, options: { on?: boolean; judge?: typeof unsure; until?: number; now?: () => number } = {}) =>
    await continueInboxRun(
      {
        db,
        api: gmail.api,
        mailbox: options.on ? gmail.mailbox : null,
        answers: gmail.mailbox,
        sources: gmail,
        model: testModel(async (input) => (asked.push(input.evidence.facts.messageId), await (options.judge ?? unsure)())),
        ...(options.until === undefined ? {} : { until: options.until }),
        now: options.now ?? (() => 100),
      },
      await firstAccount(db),
      run,
    );
  const begin = async (acts: boolean, { most = 10, at = 50 } = {}) => {
    await startInboxRuns(db, [ACCOUNT], { acts, most, now: at });
    return (await goingInboxRuns(db))[0]!.id;
  };

  it('lists the inbox and decides what Mild never saw, without moving the sync cursor', async () => {
    inGmail('a', 'b', 'c', 'gone');
    gmail.gmail.meanwhile('users.messages.list', () => gmail.gmail.change('gone', { remove: ['INBOX'] }));
    const run = await begin(false);
    expect(await goOn(run)).toMatchObject({ from: 0, to: 4, of: 4 });
    expect(listed()).toEqual(['']);
    expect(asked.toSorted()).toEqual(['a', 'b', 'c']);
    expect((await firstAccount(db)).historyId).toBe('1');
    // Recorded to suggest about only, so a pass that came to them first would not act either.
    expect(await raw(db).all('SELECT id, suggest_only FROM messages ORDER BY id')).toEqual([
      { id: 'a', suggest_only: true },
      { id: 'b', suggest_only: true },
      { id: 'c', suggest_only: true },
    ]);
    expect(await raw(db).all('SELECT finished_at FROM inbox_runs')).toEqual([{ finished_at: 100 }]);
  });

  it('lists an inbox longer than a page of Gmail’s search a page at a time, before deciding any of it', async () => {
    inGmail(...Array.from({ length: 501 }, (_, i) => `m${i}`));
    const run = await begin(false, { most: 1000 });
    let clock = 0;
    expect(await goOn(run, { until: 1, now: () => clock, judge: async () => ((clock = 1), await unsure()) })).toMatchObject({ from: 0, to: 4, of: 501 });
    expect(listed()).toEqual(['', '500']);
  });

  it('goes no further than its most, newest first', async () => {
    inGmail(...Array.from({ length: 501 }, (_, i) => `m${i}`));
    const run = await begin(false, { most: 2 });
    expect(await goOn(run)).toMatchObject({ to: 2, of: 2 });
    expect(listed()).toEqual(['']);
    expect(asked.toSorted()).toEqual(['m0', 'm1']);
  });

  it('decides again what waits on the user, but not what they answered or what was decided since it began', async () => {
    inGmail('waiting', 'answered', 'since');
    await recordSync(
      db,
      ACCOUNT,
      ['waiting', 'answered', 'since'].map((messageId) => facts({ messageId })),
      '2',
    );
    const said = { disposition: 'review', subscription: 'preserve', stage: 'model', reason: 'unsure' } as const;
    await recordDecision(db, ACCOUNT, 'waiting', said, { carryOut: false, now: 10 });
    await recordDecision(db, ACCOUNT, 'answered', said, { carryOut: false, byUser: true, now: 10 });
    await recordDecision(db, ACCOUNT, 'since', said, { carryOut: false, now: 60 });
    await goOn(await begin(false));
    expect(asked).toEqual(['waiting']);
    expect(await raw(db).all("SELECT count(*) AS n FROM decisions WHERE message_id = 'waiting'")).toEqual([{ n: 2 }]);
  });

  it('carries out what it decides only when Mild was on at the press and still is', async () => {
    await addRule(db, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');
    inGmail('a', 'b', 'c');
    // Off at the press: a suggestion, even with Mild turned on since.
    await goOn(await begin(false), { on: true });
    expect(gmail.gmail.asked('users.messages.modify')).toEqual([]);
    // On at the press, and still on.
    await goOn(await begin(true, { at: 150 }), { on: true, now: () => 200 });
    expect(await raw(db).all('SELECT message_id, carry_out, outcome FROM decisions WHERE decided_at = 200 ORDER BY message_id')).toEqual([
      { message_id: 'a', carry_out: true, outcome: 'done' },
      { message_id: 'b', carry_out: true, outcome: 'done' },
      { message_id: 'c', carry_out: true, outcome: 'done' },
    ]);
    expect(gmail.gmail.labelsOf('a')).not.toContain('INBOX');
  });

  it('decides a conversation once, by its newest message in the inbox, and archives the whole of it', async () => {
    const conversation = [
      ['first', 30],
      ['second', 20],
      ['archived', 10],
    ] as const;
    for (const [id, ago] of conversation) {
      const labelIds = id === 'archived' ? [] : ['INBOX'];
      gmail.gmail.deliver({ id, threadId: 'talk', from: 'News <news@example.com>', to: ACCOUNT, at: 1000 - ago, labelIds }, { quietly: true });
    }
    await recordSync(
      db,
      ACCOUNT,
      conversation.map(([messageId, ago]) =>
        facts({ messageId, threadId: 'talk', receivedAt: 1000 - ago, labelIds: messageId === 'archived' ? [] : ['INBOX'] }),
      ),
      '2',
    );
    const archives = async () => ({ label: 'newsletter', reason: 'a newsletter', confidence: 0.95 });
    await goOn(await begin(true), { on: true, now: () => 200, judge: archives });
    // The newest has left the inbox already: the one keeping the conversation there speaks for it.
    expect(asked).toEqual(['second']);
    for (const id of ['first', 'second']) expect(gmail.gmail.labelsOf(id)).not.toContain('INBOX');
  });

  it('takes back what Mild did before carrying out something different', async () => {
    gmail.gmail.deliver({ id: 'a', from: 'News <news@example.com>', to: ACCOUNT, labelIds: ['INBOX'] }, { quietly: true });
    await setActive(db, true);
    await recordSync(db, ACCOUNT, [facts({ messageId: 'a' })], '2');
    // Mild was not sure enough to act, and put the label the model guessed on it in Gmail.
    const guess = testModel(async () => ({ label: 'marketing', reason: 'perhaps a sale', confidence: 0.5 }));
    await triageAccount({ db, mailbox: gmail.mailbox, model: guess, sources: gmail, now: () => 10 }, await firstAccount(db));
    const marked = gmail.gmail.labelsOf('a');
    expect(marked.length).toBeGreaterThan(1);
    // Now a rule says what it is.
    await addRule(db, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');
    await goOn(await begin(true), { on: true, now: () => 200 });
    const now = gmail.gmail.labelsOf('a');
    expect(now).not.toContain('INBOX');
    expect(now.filter((l) => marked.includes(l))).toEqual([]);
  });

  it('stops at its time limit, and carries on from there', async () => {
    inGmail('a', 'b', 'c', 'd', 'e');
    const run = await begin(false);
    expect(await goOn(run, { until: 0, now: () => 0 })).toMatchObject({ to: 0, of: 0 });
    expect(listed()).toEqual([]);
    // Four at a time, each model call taking 10.
    let clock = 0;
    const slow = async () => ((clock += 10), await unsure());
    expect(await goOn(run, { until: 15, now: () => clock, judge: slow })).toMatchObject({ from: 0, to: 4, of: 5 });
    expect(await goOn(run)).toMatchObject({ from: 4, to: 5 });
    expect(asked.toSorted()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await goOn(run)).toBeNull();
  });

  it('leaves what the model was not asked about for the next piece, in order', async () => {
    inGmail(...Array.from({ length: 13 }, (_, i) => `m${i}`));
    const run = await begin(false, { most: 20 });
    const down = async (): Promise<Awaited<ReturnType<typeof unsure>>> => {
      throw new Error('provider down');
    };
    // Three failures in a row and each of the four stops asking: the thirteenth is not asked.
    expect(await goOn(run, { judge: down })).toMatchObject({ to: 12, of: 13 });
    expect(asked).toHaveLength(12);
    await goOn(run);
    expect(asked.at(-1)).toBe('m12');
    expect(await raw(db).all('SELECT finished_at FROM inbox_runs')).toEqual([{ finished_at: 100 }]);
  });

  it('stops when the person stops it, keeping what it decided', async () => {
    inGmail('a', 'b', 'c', 'd', 'e');
    const run = await begin(false);
    await goOn(run, { judge: async () => (await stopInboxRuns(db, null, 70), await unsure()) });
    expect(asked).toHaveLength(4);
    expect(await raw(db).all('SELECT next, finished_at, stopped FROM inbox_runs')).toEqual([{ next: 4, finished_at: 70, stopped: true }]);
    expect(await goOn(run)).toBeNull();
    expect(await inboxProgress(db, [ACCOUNT])).toEqual({ going: null, last: { finishedAt: 70, total: 4, spent: 0, stopped: true } });
  });

  it('estimates from what model calls cost lately and how much mail went to the model, once there are enough of each', async () => {
    expect(await averageCall(db)).toBeNull();
    expect(await modelShare(db, 0)).toBeNull();
    const ids = Array.from({ length: 20 }, (_, i) => `e${i}`);
    await recordSync(
      db,
      ACCOUNT,
      ids.map((messageId) => facts({ messageId })),
      '2',
    );
    for (const [i, id] of ids.entries()) {
      const run = await modelRun(db, {
        messageId: id,
        at: 10,
        usage: { model: 'test/model', inputTokens: 1000, outputTokens: 100, costUsd: i < 10 ? 0.001 : 0.003 },
      });
      // Half went to the model.
      const said = { disposition: 'keep', subscription: 'preserve', stage: i % 2 ? 'model' : 'rules', reason: 'r' } as const;
      await recordDecision(db, ACCOUNT, id, said, { carryOut: false, now: 10, ...(i % 2 ? { runId: run } : {}) });
    }
    // A provider that reported no usage says nothing.
    await modelRun(db, { messageId: 'e0', at: 10 });
    expect(await averageCall(db, 'test/model')).toEqual({ costUsd: expect.closeTo(0.002), inputTokens: 1000, outputTokens: 100 });
    // Calls on another model still say how big the person's calls are.
    expect(await averageCall(db, 'other/model')).toBeNull();
    expect(await averageCall(db)).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
    expect(await modelShare(db, 0)).toBe(0.5);
    expect(await modelShare(db, 11)).toBeNull();
  });
});
