import { describe, expect, it } from 'vitest';
import type { Sql } from '../src/store/sql.ts';
import { summarize } from '../src/dashboard/queries/summary.ts';
import { usage } from '../src/dashboard/queries/usage.ts';
import { recordSync } from '../src/store/accounts.ts';
import { finishAction, insertPendingAction, setActionStatus } from '../src/store/actions.ts';
import { recordDecision, settleDecision } from '../src/store/decisions.ts';
import { digestInserted, startDigest } from '../src/store/digests.ts';
import { onePerson } from './fixtures.ts';
import { ACCOUNT, DAY, everything, facts } from './helpers.ts';

const NOW = Date.UTC(2026, 5, 15, 12);
const base = { subscription: 'preserve', reason: 'test', stage: 'rules' } as const;

/** A decision of Mild's own, carried out in Gmail; returns its change. */
async function done(db: Sql, messageId: string, decision: Partial<Parameters<typeof recordDecision>[3]> = {}, options: { byUser?: boolean; at?: number } = {}) {
  const at = options.at ?? NOW;
  const id = await recordDecision(
    db,
    ACCOUNT,
    messageId,
    { ...base, disposition: 'archive', ...decision },
    { carryOut: true, byUser: options.byUser ?? false, now: at },
  );
  const change = await insertPendingAction(
    db,
    { accountId: ACCOUNT, messageId, type: 'archive', payload: { add: [], remove: ['INBOX'] }, originalLabels: ['INBOX'], decisionId: id },
    at,
  );
  await finishAction(db, change, 'done', [], null, at);
  await settleDecision(db, id, 'done');
  return change;
}

async function mailbox(ids: string[], read: string[] = []) {
  const { db } = await onePerson(ACCOUNT);
  await recordSync(
    db,
    ACCOUNT,
    ids.map((messageId) => facts({ messageId, receivedAt: NOW - DAY })),
    '1',
    NOW - DAY,
  );
  if (read.length > 0) await recordSync(db, ACCOUNT, [], '2', NOW, read);
  return db;
}

describe('attention saved', () => {
  it('counts mail Mild took out of the inbox, a glance each, and not what was undone, answered, opened, kept or only suggested', async () => {
    const db = await mailbox(['kept', 'spam', 'undone', 'answered', 'opened', 'left', 'suggested', 'news'], ['opened']);
    await done(db, 'kept', { labelId: 'marketing' });
    await done(db, 'spam', { disposition: 'spam', labelId: 'marketing' });
    await done(db, 'news', { labelId: 'newsletter' });
    await setActionStatus(db, await done(db, 'undone', { labelId: 'marketing' }), 'undone');
    await done(db, 'answered', { labelId: 'marketing' }, { byUser: true });
    await done(db, 'opened', { labelId: 'marketing' });
    await done(db, 'left', { disposition: 'keep' });
    await recordDecision(db, ACCOUNT, 'suggested', { ...base, disposition: 'archive' }, { now: NOW });

    const { saved } = await summarize(db, await everything(db), 7, NOW);
    expect(saved).toMatchObject({ messages: 3, seconds: 30, unsubscribed: { senders: 0, monthly: 0 } });
    expect(saved.byLabel.map((r) => [r.labelId, r.messages])).toEqual([
      ['marketing', 2],
      ['newsletter', 1],
    ]);
  });

  it('takes the digest it put back off its label, on Activity and in the masthead alike', async () => {
    const db = await mailbox(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) await done(db, id, { labelId: 'newsletter', digest: true });
    const digest = await startDigest(db, { labelId: 'newsletter', accountId: ACCOUNT, since: NOW - DAY, until: NOW, count: 3, model: null, now: NOW });
    await digestInserted(db, digest.id, 'g1', NOW);
    expect((await summarize(db, await everything(db), 7, NOW)).saved).toMatchObject({ messages: 2, byLabel: [{ labelId: 'newsletter', messages: 2 }] });
    const { saved } = await usage(db, await everything(db), NOW);
    expect(saved.month).toEqual({ messages: 2, seconds: 20 });
    expect(saved.daily.at(-1)).toBe(20);
  });

  it('says what it saved over a day, a week and 30 days, and what it would have while off', async () => {
    const db = await mailbox(['today', 'lastWeek', 'sure', 'unsure', 'corrected']);
    await done(db, 'today');
    await done(db, 'lastWeek', {}, { at: NOW - 10 * DAY });
    await recordDecision(db, ACCOUNT, 'sure', { ...base, disposition: 'archive' }, { now: NOW });
    await recordDecision(db, ACCOUNT, 'unsure', { ...base, disposition: 'review', stage: 'model', confidence: 0.4 }, { now: NOW });
    // Mild said archive; the reader's answer since does not change what Mild would have done.
    await recordDecision(db, ACCOUNT, 'corrected', { ...base, disposition: 'spam' }, { now: NOW });
    await recordDecision(db, ACCOUNT, 'corrected', { ...base, disposition: 'keep' }, { byUser: true, now: NOW });

    const { saved } = await usage(db, await everything(db), NOW);
    expect(saved.day).toEqual({ messages: 1, seconds: 10 });
    expect(saved.week).toEqual({ messages: 1, seconds: 10 });
    expect(saved.month).toEqual({ messages: 2, seconds: 20 });
    expect(saved.daily).toHaveLength(30);
    expect(saved.daily.reduce((a, b) => a + b)).toBe(20);
    expect(saved.wouldHave).toEqual({ messages: 2, seconds: 20 });
  });

  it('counts the senders it unsubscribed from and what they sent the month before', async () => {
    const { db } = await onePerson(ACCOUNT);
    const from = (address: string) => ({ address, domain: address.split('@')[1]!, name: 'List' });
    await recordSync(
      db,
      ACCOUNT,
      [
        ...[5, 12, 20, 45].map((ago, i) => facts({ messageId: `n${i}`, from: from('news@example.com'), receivedAt: NOW - ago * DAY })),
        facts({ messageId: 'p0', from: from('promo@example.org'), receivedAt: NOW - 2 * DAY }),
      ],
      '1',
      NOW,
    );
    for (const messageId of ['n0', 'n1', 'p0']) {
      const change = await insertPendingAction(
        db,
        { accountId: ACCOUNT, messageId, type: 'unsubscribe', payload: { add: [], remove: [], unsubscribe: 'example.com' }, originalLabels: [] },
        NOW - DAY,
      );
      await finishAction(db, change, 'done', null, null, NOW - DAY);
    }
    expect((await summarize(db, await everything(db), 7, NOW)).saved.unsubscribed).toEqual({ senders: 2, monthly: 4 });
  });
});
