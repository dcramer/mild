import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, renderSettings } from '../src/config.ts';
import { pruneOld } from '../src/daemon/retention.ts';
import { type RunOptions, createWake, runLoop } from '../src/daemon/run.ts';
import { applyFeedback, pendingSuggestions } from '../src/learn/feedback.ts';
import { connectAccount, recordSync } from '../src/store/accounts.ts';
import { finishAction, insertPendingAction, unsubscribedAt } from '../src/store/actions.ts';
import { openDb } from '../src/store/db.ts';
import { recordDecision, settleDecision } from '../src/store/decisions.ts';
import { listUndecided } from '../src/store/messages.ts';
import { addRule } from '../src/store/rules.ts';
import type { Decision } from '../src/triage/types.ts';
import { facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
const DAY = 86_400_000;
const NOW = 100 * DAY;
const OLD = 10 * DAY;
const RECENT = 90 * DAY;

let db: DatabaseSync;

const archive: Decision = { disposition: 'archive', subscription: 'preserve', labelId: 'newsletter', stage: 'agent', reason: 'test' };

function message(id: string, at = OLD, from = `${id}@example.com`): void {
  recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: id, receivedAt: at, from: { address: from, domain: 'example.com' } })], '1', at);
}

/** A message sift decided and changed long ago. */
function acted(id: string, type = 'archive'): { decisionId: number; actionId: number } {
  message(id);
  const decisionId = recordDecision(db, ACCOUNT, id, archive, { mode: 'act', now: OLD });
  settleDecision(db, decisionId, 'done');
  const actionId = insertPendingAction(
    db,
    { accountId: ACCOUNT, messageId: id, type, payload: { add: [], remove: ['INBOX'] }, originalLabels: ['INBOX'], decisionId },
    OLD,
  );
  finishAction(db, actionId, 'done', [], null, OLD);
  return { decisionId, actionId };
}

const left = (table: string, column = 'message_id') =>
  (db.prepare(`SELECT ${column} AS id FROM ${table} ORDER BY 1`).all() as { id: string }[]).map((r) => r.id);

beforeEach(() => {
  db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
});

describe('pruneOld', () => {
  it('forgets an old message with its decisions and changes', () => {
    acted('gone');
    acted('fresh');
    message('new', RECENT);
    recordDecision(db, ACCOUNT, 'new', archive, { mode: 'act', now: RECENT });
    db.prepare(`UPDATE actions SET created_at = ? WHERE message_id = 'fresh'`).run(RECENT);

    expect(pruneOld(db, 30, NOW)).toBe(1);
    expect(left('messages', 'id')).toEqual(['fresh', 'new']);
    expect(left('decisions')).toEqual(['fresh', 'new']);
    expect(left('actions')).toEqual(['fresh']);
    expect(pruneOld(db, 30, NOW)).toBe(0);
  });

  it('keeps a suggestion that is still waiting, and forgets it once it is not', () => {
    message('waiting');
    recordDecision(db, ACCOUNT, 'waiting', archive, { now: OLD });
    message('told');
    const ruleId = addRule(db, ACCOUNT, { match: { from: 'told@example.com' }, labelId: 'newsletter' }, 'user');
    recordDecision(db, ACCOUNT, 'told', { ...archive, stage: 'rules', ruleId }, { now: OLD });
    expect(pendingSuggestions(db).map((s) => s.messageId)).toEqual(['waiting']);

    expect(pruneOld(db, 30, NOW)).toBe(1);
    expect(left('messages', 'id')).toEqual(['waiting']);
  });

  it('keeps what the user answered for', () => {
    message('answered');
    recordDecision(db, ACCOUNT, 'answered', archive, { now: OLD });
    applyFeedback(db, { accountId: ACCOUNT, sender: 'answered@example.com', label: 'newsletter', scope: 'once' }, OLD);

    expect(pruneOld(db, 30, NOW)).toBe(0);
    expect(left('examples')).toEqual(['answered']);
    expect(left('feedback')).toEqual(['answered']);
  });

  it('keeps a message that is undecided, not yet carried out, or changed without confirmation', () => {
    message('undecided');
    message('unsettled');
    recordDecision(db, ACCOUNT, 'unsettled', archive, { mode: 'act', now: OLD });
    const { actionId } = acted('unconfirmed');
    finishAction(db, actionId, 'unknown', null, 'timeout', OLD);

    expect(pruneOld(db, 30, NOW)).toBe(0);
    expect(listUndecided(db, ACCOUNT, 10).map((m) => m.facts.messageId)).toEqual(['undecided']);
  });

  it('keeps the record of an unsubscribe, so the sender is not asked twice', () => {
    acted('list', 'unsubscribe');
    expect(pruneOld(db, 30, NOW)).toBe(0);
    expect(unsubscribedAt(db, ACCOUNT, 'list@example.com')).toBe(OLD);
  });
});

describe('retention', () => {
  it('is off unless sift.toml sets it, and refuses a window sync could reach back into', () => {
    expect(DEFAULT_SETTINGS.retentionDays).toBeUndefined();
    expect(parseSettings('[retention]\ndays = 90').retentionDays).toBe(90);
    expect(parseSettings(renderSettings({ ...DEFAULT_SETTINGS, retentionDays: 365 })).retentionDays).toBe(365);
    expect(() => parseSettings('[retention]\ndays = 7')).toThrow('retention.days must be a whole number of days, at least 30');
    expect(() => parseSettings('[retention]\nday = 90')).toThrow('unknown setting retention.day');
  });

  it('runs on the first pass and then once a day', async () => {
    const logs: string[] = [];
    const stop = new AbortController();
    const wake = createWake();
    let now = NOW;
    let pass = 0;
    const next = async (): Promise<RunOptions & { intervalMs: number; retentionDays?: number }> => {
      pass++;
      return {
        act: false,
        connect: () => {
          throw new Error('not connected');
        },
        log: (line) => logs.push(line),
        now: () => now,
        intervalMs: 60_000,
        ...(pass === 1 ? {} : { retentionDays: 30 }),
      };
    };
    acted('first');
    await runLoop(db, next, {
      signal: stop.signal,
      wake,
      onPass: () => {
        // Something else grows old after the first prune: it stays until a day has passed.
        if (pass === 3) acted('second');
        if (pass === 4) now += DAY;
        if (pass < 4) setTimeout(() => wake.now(), 1);
        else setTimeout(() => stop.abort(), 1);
      },
    });
    expect(logs.filter((line) => line.startsWith('Forgot'))).toEqual([
      'Forgot 1 message with nothing newer than 30 days',
      'Forgot 1 message with nothing newer than 30 days',
    ]);
    expect(left('messages', 'id')).toEqual([]);
  });
});
