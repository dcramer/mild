import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { RETENTION_DAYS, pruneOld } from '../src/daemon/retention.ts';
import { type RunOptions, createWake, runLoop } from '../src/daemon/run.ts';
import { applyFeedback, pendingSuggestions } from '../src/learn/feedback.ts';
import { recordSync } from '../src/store/accounts.ts';
import { type ActionType, finishAction, insertPendingAction, unsubscribedAt } from '../src/store/actions.ts';
import { recordDecision, settleDecision } from '../src/store/decisions.ts';
import { listUndecided } from '../src/store/messages.ts';
import { addRule } from '../src/store/rules.ts';
import { finishRun, startRun } from '../src/store/runs.ts';
import type { Decision } from '../src/triage/types.ts';
import { raw, onePerson } from './fixtures.ts';
import { facts } from './helpers.ts';
import type { Store } from '../src/store/store.ts';

const ACCOUNT = 'me@example.org';
const DAY = 86_400_000;
const OLD = 10 * DAY;
const NOW = OLD + (RETENTION_DAYS + 1) * DAY;
const RECENT = NOW - 10 * DAY;

let db: Sql;
let store: Store;

const archive: Decision = { disposition: 'archive', subscription: 'preserve', labelId: 'newsletter', stage: 'agent', reason: 'test' };

async function message(id: string, at = OLD, from = `${id}@example.com`): Promise<void> {
  await recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: id, receivedAt: at, from: { address: from, domain: 'example.com' } })], '1', at);
}

/** A message sift decided and changed long ago. */
async function acted(id: string, type: ActionType = 'archive'): Promise<{ decisionId: number; actionId: number }> {
  await message(id);
  const decisionId = await recordDecision(db, ACCOUNT, id, archive, { mode: 'act', now: OLD });
  await settleDecision(db, decisionId, 'done');
  const actionId = await insertPendingAction(
    db,
    { accountId: ACCOUNT, messageId: id, type, payload: { add: [], remove: ['INBOX'] }, originalLabels: ['INBOX'], decisionId },
    OLD,
  );
  await finishAction(db, actionId, 'done', [], null, OLD);
  return { decisionId, actionId };
}

const left = async (table: string, column = 'message_id') =>
  (await raw(db).all<{ id: string }>(`SELECT ${column} AS id FROM ${table} ORDER BY 1`)).map((r) => r.id);

beforeEach(async () => {
  ({ store, db } = await onePerson(ACCOUNT));
});

describe('pruneOld', () => {
  it('forgets an old message with its decisions, changes and model runs', async () => {
    await acted('gone');
    await finishRun(db, await startRun(db, { accountId: ACCOUNT, messageId: 'gone', model: 'p/m', now: OLD }), { outcome: 'judged', now: OLD });
    await acted('fresh');
    await message('new', RECENT);
    await recordDecision(db, ACCOUNT, 'new', archive, { mode: 'act', now: RECENT });
    await raw(db).run(`UPDATE actions SET created_at = ? WHERE message_id = 'fresh'`, RECENT);

    expect(await pruneOld(db, NOW)).toBe(1);
    expect(await left('messages', 'id')).toEqual(['fresh', 'new']);
    expect(await left('decisions')).toEqual(['fresh', 'new']);
    expect(await left('actions')).toEqual(['fresh']);
    expect(await left('model_runs')).toEqual([]);
    expect(await pruneOld(db, NOW)).toBe(0);
  });

  it('keeps a suggestion that is still waiting, and forgets it once it is not', async () => {
    await message('waiting');
    await recordDecision(db, ACCOUNT, 'waiting', archive, { now: OLD });
    await message('told');
    const ruleId = await addRule(db, ACCOUNT, { match: { from: 'told@example.com' }, labelId: 'newsletter' }, 'user');
    await recordDecision(db, ACCOUNT, 'told', { ...archive, stage: 'rules', ruleId }, { now: OLD });
    expect((await pendingSuggestions(db)).map((s) => s.messageId)).toEqual(['waiting']);

    expect(await pruneOld(db, NOW)).toBe(1);
    expect(await left('messages', 'id')).toEqual(['waiting']);
  });

  it('keeps what the user answered for', async () => {
    await message('answered');
    await recordDecision(db, ACCOUNT, 'answered', archive, { now: OLD });
    await applyFeedback(db, { accountId: ACCOUNT, sender: 'answered@example.com', label: 'newsletter', scope: 'once' }, OLD);

    expect(await pruneOld(db, NOW)).toBe(0);
    expect(await left('examples')).toEqual(['answered']);
    expect(await left('feedback')).toEqual(['answered']);
  });

  it('keeps a message that is undecided, not yet carried out, or changed without confirmation', async () => {
    await message('undecided');
    await message('unsettled');
    await recordDecision(db, ACCOUNT, 'unsettled', archive, { mode: 'act', now: OLD });
    const { actionId } = await acted('unconfirmed');
    await finishAction(db, actionId, 'unknown', null, 'timeout', OLD);

    expect(await pruneOld(db, NOW)).toBe(0);
    expect((await listUndecided(db, ACCOUNT, 10)).map((m) => m.facts.messageId)).toEqual(['undecided']);
  });

  it('keeps the record of an unsubscribe, so the sender is not asked twice', async () => {
    await acted('list', 'unsubscribe');
    expect(await pruneOld(db, NOW)).toBe(0);
    expect(await unsubscribedAt(db, ACCOUNT, 'list@example.com')).toBe(OLD);
  });
});

describe('retention', () => {
  it('runs on the first pass and then once a day', async () => {
    const logs: string[] = [];
    const stop = new AbortController();
    const wake = createWake();
    let now = NOW;
    let pass = 0;
    const next = async (): Promise<RunOptions> => {
      pass++;
      return {
        connect: () => {
          throw new Error('not connected');
        },
        log: (line) => logs.push(line),
        now: () => now,
      };
    };
    await acted('first');
    await runLoop(store, next, {
      signal: stop.signal,
      wake,
      onPass: async () => {
        // Something else grows old after the first prune: it stays until a day has passed.
        if (pass === 3) await acted('second');
        if (pass === 4) now += DAY;
        if (pass < 4) setTimeout(() => wake.now(), 1);
        else setTimeout(() => stop.abort(), 1);
      },
    });
    expect(logs.filter((line) => line.startsWith('Forgot'))).toEqual([
      'Forgot 1 message with nothing newer than 365 days',
      'Forgot 1 message with nothing newer than 365 days',
    ]);
    expect(await left('messages', 'id')).toEqual([]);
  });
});
