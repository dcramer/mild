import { beforeEach, describe, expect, it } from 'vitest';
import type { GmailApi, RawMessage } from '../src/gmail/api.ts';
import type { Sql } from '../src/store/sql.ts';
import type { Store } from '../src/store/store.ts';
import { type Ephemeral, memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { finishAction, insertPendingAction } from '../src/store/actions.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { setRuleFilter } from '../src/store/filters.ts';
import { setActive } from '../src/store/preferences.ts';
import { examples } from '../src/store/query.ts';
import { addRule } from '../src/store/rules.ts';
import { type RunOptions, dueWork } from '../src/work/run.ts';
import { FILTER_CHECK_MINUTES } from '../src/work/filters.ts';
import { passStatus, recordPassStatus } from '../src/work/status.ts';
import type { Decision } from '../src/triage/types.ts';
import { onePerson, raw } from './fixtures.ts';
import { ACCOUNT, DAY, FakeMailbox, rawMessage, testModel, workDue } from './helpers.ts';

const MINUTE = 60_000;

let store: Store;
let db: Sql;
let person: number;
let mailbox: FakeMailbox;
let ephemeral: Ephemeral;
/** Gmail's history id: it moves with every change to the mailbox. */
let history: number;
let arrived: { at: number; raw: RawMessage }[];
let clock: number;
let asked: string[];
let failing: boolean;

function gmail(): GmailApi {
  const reached = (call: string) => {
    asked.push(call);
    if (failing) throw new Error('invalid_grant');
  };
  return {
    getProfile: async () => (reached('getProfile'), { emailAddress: ACCOUNT, historyId: String(history) }),
    listHistory: async (start) => (
      reached('listHistory'),
      { additions: arrived.filter((a) => a.at > Number(start)).map((a) => ({ id: a.raw.id, labelIds: a.raw.labelIds })), historyId: String(history) }
    ),
    searchInbox: async () => ({ ids: [] }),
    inboxSize: async () => arrived.length,
    getMetadata: async (id) => arrived.find((a) => a.raw.id === id)?.raw ?? null,
    getLabelIds: async (id) => mailbox.labels.get(id) ?? null,
    listLabels: async () => [],
    getThread: async () => null,
    listSendAs: async () => [ACCOUNT],
    getContent: async (id) => ({ text: `Body ${id}`, html: null, facts: { hasAttachments: false } }),
  };
}

function arrive(id: string, from: string) {
  history++;
  const raw = rawMessage(id, { from, internalDate: clock });
  arrived.push({ at: history, raw });
  mailbox.labels.set(id, [...raw.labelIds]);
}

const options = (more: Partial<RunOptions> = {}): RunOptions => ({
  ephemeral,
  connect: () => ({ api: gmail(), mailbox }),
  log: () => {},
  now: () => clock,
  ...more,
});

/** Whether the timed tick, a minute on, begins a pass over the mailbox. */
async function timedTickPasses(more: Partial<RunOptions> = {}): Promise<boolean> {
  clock += MINUTE;
  return (await dueWork(store, options(more))).some((piece) => piece.kind === 'pass');
}

const decision = (disposition: Decision['disposition']): Decision => ({ disposition, subscription: 'preserve', stage: 'rules', reason: 'a rule' });

beforeEach(async () => {
  ({ store, db } = await onePerson(ACCOUNT));
  person = (await raw(store.central).get<{ id: number }>('SELECT id FROM users'))!.id;
  mailbox = new FakeMailbox();
  ephemeral = memoryEphemeral();
  history = 1;
  arrived = [];
  clock = 10 * DAY + 1000;
  asked = [];
  failing = false;
  // Waiting for a model, which there is none of: no pass can do anything with it.
  arrive('news', 'News <news@example.com>');
  await workDue(store, options(), Infinity);
  expect(await raw(db).all('SELECT id FROM messages')).toEqual([{ id: 'news' }]);
  asked = [];
});

describe('the timed tick', () => {
  it('begins no pass over a mailbox with nothing to do, asks Gmail only where its history is, and says when it looked', async () => {
    expect(await timedTickPasses()).toBe(false);
    expect(asked).toEqual(['getProfile']);
    expect(await passStatus(ephemeral, [ACCOUNT])).toMatchObject({ lastPassAt: clock, problems: [] });
  });

  it('begins one when new mail came', async () => {
    arrive('ada', 'Ada <ada@example.org>');
    expect(await timedTickPasses()).toBe(true);
  });

  it('begins none while the Google sign-in has expired, and says so, then one once Gmail answers again', async () => {
    failing = true;
    expect(await timedTickPasses()).toBe(false);
    expect(await passStatus(ephemeral, [ACCOUNT])).toMatchObject({ problems: [`${ACCOUNT}: invalid_grant`], expired: [ACCOUNT] });
    expect(await timedTickPasses()).toBe(false);
    failing = false;
    expect(await timedTickPasses()).toBe(true);
  });

  it('begins one when the last pass ran out of time, or nothing says a pass ever ran', async () => {
    await recordPassStatus(ephemeral, ACCOUNT, { at: clock, unfinished: true });
    expect(await timedTickPasses()).toBe(true);
    ephemeral = memoryEphemeral();
    expect(await timedTickPasses()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('begins one on the first tick of a day, which reads the mailbox’s other addresses again', async () => {
    clock += DAY;
    expect(await timedTickPasses()).toBe(true);
  });

  it('begins one for mail waiting to be decided only while there is a model to decide it', async () => {
    expect(await timedTickPasses({ model: async () => testModel() })).toBe(true);
    expect(await timedTickPasses({ model: async () => null })).toBe(false);
  });

  it('begins one for a change to the mailbox not yet confirmed, while Sift is on', async () => {
    await insertPendingAction(
      db,
      { accountId: ACCOUNT, messageId: 'news', type: 'archive', payload: { add: [], remove: ['INBOX'] }, originalLabels: ['INBOX'] },
      clock,
    );
    expect(await timedTickPasses()).toBe(false);
    await setActive(db, true);
    expect(await timedTickPasses()).toBe(true);
  });

  it('settles an unsubscribe cut short, then begins none for it: no mailbox can tell whether it took', async () => {
    await setActive(db, true);
    const id = await insertPendingAction(
      db,
      { accountId: ACCOUNT, messageId: 'news', type: 'unsubscribe', payload: { add: [], remove: [] }, originalLabels: [] },
      clock,
    );
    expect(await timedTickPasses()).toBe(true);
    await workDue(store, options(), Infinity);
    expect(await raw(db).get('SELECT status FROM actions WHERE id = ?', id)).toEqual({ status: 'unknown' });
    expect(await timedTickPasses()).toBe(false);
  });

  it('begins one for a decision to carry out: any while Sift is on, only the person’s own answer while off', async () => {
    await recordDecision(db, ACCOUNT, 'news', decision('archive'), { carryOut: true, now: clock });
    expect(await timedTickPasses()).toBe(false);
    await setActive(db, true);
    expect(await timedTickPasses()).toBe(true);
    await setActive(db, false);
    await recordDecision(db, ACCOUNT, 'news', decision('archive'), { carryOut: true, byUser: true, now: clock });
    expect(await timedTickPasses()).toBe(true);
  });

  it('begins one for the text of mail waiting on the person, to keep or to let go', async () => {
    await recordDecision(db, ACCOUNT, 'news', decision('archive'), { now: clock });
    expect(await timedTickPasses()).toBe(true);
    await workDue(store, options(), Infinity);
    expect(await raw(db).all('SELECT message_id FROM suggestion_bodies')).toEqual([{ message_id: 'news' }]);
    expect(await timedTickPasses()).toBe(false);
    // Decided again, to be carried out once Sift is on: it no longer waits on the person, and its text is to go.
    await recordDecision(db, ACCOUNT, 'news', decision('archive'), { carryOut: true, now: clock });
    expect(await timedTickPasses()).toBe(true);
  });

  it('begins one for a marked message to store as an example', async () => {
    await db.insert(examples).values({ accountId: ACCOUNT, messageId: 'news', markedAt: clock });
    expect(await timedTickPasses()).toBe(true);
  });

  describe('when Gmail filters are due a look', () => {
    const filtered = () => addRule(db, { match: { from: ['news@example.com'] }, disposition: 'archive' }, 'user', clock);
    const change = async (ruleId: string) =>
      await insertPendingAction(
        db,
        { accountId: ACCOUNT, messageId: null, type: 'filter', payload: { add: [], remove: [], filter: { ruleId } }, originalLabels: [] },
        clock,
      );

    it('begins one for a rule that is a filter in Gmail, and none between looks', async () => {
      await setRuleFilter(db, await filtered(), ACCOUNT, { filterId: 'f1', state: 'active', written: null }, clock);
      expect(await timedTickPasses()).toBe(false);
      clock += FILTER_CHECK_MINUTES * MINUTE;
      expect(await timedTickPasses()).toBe(true);
    });

    it('begins one for a filter change never read back', async () => {
      await change(await filtered());
      clock += FILTER_CHECK_MINUTES * MINUTE;
      expect(await timedTickPasses()).toBe(true);
    });

    it('begins one for a filter change Gmail did not take, to ask again while Sift is on', async () => {
      await finishAction(db, await change(await filtered()), 'failed', null, 'network down', clock);
      clock += FILTER_CHECK_MINUTES * MINUTE;
      expect(await timedTickPasses()).toBe(false);
      await setActive(db, true);
      expect(await timedTickPasses()).toBe(true);
    });
  });
});

it('a person’s own press begins their pass without looking', async () => {
  expect((await dueWork(store, options(), [person])).filter((piece) => piece.kind === 'pass')).toHaveLength(1);
  expect(asked).toEqual([]);
});
