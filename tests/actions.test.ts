import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ActionDeps, execute, reconcile, undo } from '../src/actions/executor.ts';
import { planAction } from '../src/actions/plan.ts';
import { connectAccount, recordSync } from '../src/store/accounts.ts';
import { getAction, listRecentActions } from '../src/store/actions.ts';
import { openDb } from '../src/store/db.ts';
import { FakeMailbox, facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';

let db: DatabaseSync;
let mailbox: FakeMailbox;
let deps: ActionDeps;

beforeEach(() => {
  db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
  recordSync(db, ACCOUNT, [facts({ messageId: 'm1' })], '2');
  mailbox = new FakeMailbox();
  mailbox.labels.set('m1', ['INBOX', 'UNREAD', 'L:mine']);
  deps = { db, mailbox, now: () => 1000 };
});

describe('execute', () => {
  it('archives with an audit label, preserving unread state and other labels', async () => {
    const outcome = await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    expect(outcome).toMatchObject({ status: 'done', finalLabels: ['UNREAD', 'L:mine', 'L:sift/archived'] });
    const action = getAction(db, 1);
    expect(action).toMatchObject({
      type: 'archive',
      status: 'done',
      originalLabels: ['INBOX', 'UNREAD', 'L:mine'],
      payload: { add: ['L:sift/archived'], remove: ['INBOX'] },
    });
  });

  it('uses the given reason label when archiving', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive', label: 'sift/newsletters' });
    expect(mailbox.labels.get('m1')).toContain('L:sift/newsletters');
    expect(mailbox.labels.get('m1')).not.toContain('L:sift/archived');
  });

  it('labels without moving the message', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'label', label: 'sift/review' });
    expect(mailbox.labels.get('m1')).toEqual(['INBOX', 'UNREAD', 'L:mine', 'L:sift/review']);
  });

  it('never touches a message that is not in the inbox or no longer exists', async () => {
    mailbox.labels.set('m1', ['UNREAD']);
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'archive' })).toEqual({ status: 'skipped', reason: 'message is not in the inbox' });
    expect(await execute(deps, ACCOUNT, 'gone', { type: 'archive' })).toEqual({ status: 'skipped', reason: 'message no longer exists' });
    expect(mailbox.modifyCalls).toBe(0);
    expect(listRecentActions(db, 10)).toEqual([]);
  });

  it('skips when the message already has the label', async () => {
    mailbox.labels.set('m1', ['INBOX', 'L:sift/review']);
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'label', label: 'sift/review' })).toMatchObject({ status: 'skipped' });
    expect(mailbox.modifyCalls).toBe(0);
  });

  it('marks spam with an audit label', async () => {
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'spam' })).toMatchObject({ status: 'done' });
    expect(mailbox.labels.get('m1')).toEqual(['UNREAD', 'L:mine', 'L:sift/spam', 'SPAM']);
  });

  it('refuses spam for a sender the user has written to, an unknown sender, or a failed lookup', async () => {
    mailbox.sentTo.add('news@example.com');
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'spam' })).toMatchObject({ status: 'skipped', reason: expect.stringContaining('written to') });

    mailbox.sentTo.clear();
    mailbox.failSentLookup = true;
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'spam' })).toMatchObject({ status: 'skipped', reason: expect.stringContaining('could not check') });

    mailbox.labels.set('unsynced', ['INBOX']);
    expect(await execute(deps, ACCOUNT, 'unsynced', { type: 'spam' })).toMatchObject({ status: 'skipped', reason: expect.stringContaining('unknown') });
    expect(mailbox.modifyCalls).toBe(0);
  });

  it('records unknown when the provider call errors, then settles it from the mailbox without replaying', async () => {
    mailbox.failModify = 'after';
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'archive' })).toMatchObject({ status: 'unknown', actionId: 1, reason: 'timeout' });
    expect(getAction(db, 1)?.status).toBe('unknown');

    mailbox.failModify = null;
    expect(await reconcile(deps)).toBe(1);
    expect(getAction(db, 1)).toMatchObject({ status: 'done', finalLabels: ['UNREAD', 'L:mine', 'L:sift/archived'] });
    expect(mailbox.modifyCalls).toBe(1);
  });

  it('settles a change that never landed as failed, and the next execute starts clean', async () => {
    mailbox.failModify = 'before';
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'archive' })).toMatchObject({ status: 'unknown' });

    mailbox.failModify = null;
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'archive' })).toMatchObject({ status: 'done', actionId: 2 });
    expect(getAction(db, 1)).toMatchObject({ status: 'failed', error: 'network down' });
  });

  it('settles a crash that left an action pending', async () => {
    db.prepare(
      `INSERT INTO actions (account_id, message_id, type, payload_json, original_labels, status, created_at) VALUES (?, 'm1', 'archive', ?, '["INBOX"]', 'pending', 0)`,
    ).run(ACCOUNT, JSON.stringify({ add: ['L:sift/archived'], remove: ['INBOX'] }));
    await reconcile(deps);
    expect(getAction(db, 1)).toMatchObject({ status: 'failed', error: 'change was not applied' });
  });
});

describe('undo', () => {
  it('restores the inbox and removes what was added', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'spam' });
    expect(await undo(deps, 1)).toMatchObject({ status: 'done', actionId: 2 });
    expect(mailbox.labels.get('m1')?.toSorted()).toEqual(['INBOX', 'L:mine', 'UNREAD']);
    expect(getAction(db, 1)?.status).toBe('undone');
    expect(getAction(db, 2)).toMatchObject({ type: 'undo', status: 'done', payload: { undoOf: 1 } });
  });

  it('keeps changes the user made afterwards', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    mailbox.labels.set('m1', ['INBOX', 'L:sift/archived', 'L:later']);
    await undo(deps, 1);
    expect(mailbox.labels.get('m1')).toEqual(['INBOX', 'L:later']);
  });

  it('marks the action undone when the user already reversed it by hand', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    mailbox.labels.set('m1', ['INBOX']);
    expect(await undo(deps, 1)).toMatchObject({ status: 'skipped' });
    expect(getAction(db, 1)?.status).toBe('undone');
  });

  it('refuses to undo twice, to undo an undo, or to touch trashed mail', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    await undo(deps, 1);
    await expect(undo(deps, 1)).rejects.toThrow(/is undone/);
    await expect(undo(deps, 2)).rejects.toThrow(/itself an undo/);
    await expect(undo(deps, 99)).rejects.toThrow(/No action 99/);

    await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    mailbox.labels.set('m1', ['TRASH']);
    await expect(undo(deps, 3)).rejects.toThrow(/trash/);
  });
});

describe('planAction', () => {
  const base = { subscription: 'preserve', stage: 'rules', reason: '' } as const;

  it('maps decisions to actions', () => {
    expect(planAction({ ...base, disposition: 'keep' })).toBeNull();
    expect(planAction({ ...base, disposition: 'keep', label: 'sift/people' })).toEqual({ type: 'label', label: 'sift/people' });
    expect(planAction({ ...base, disposition: 'archive' })).toEqual({ type: 'archive' });
    expect(planAction({ ...base, disposition: 'archive', label: 'sift/news' })).toEqual({ type: 'archive', label: 'sift/news' });
    expect(planAction({ ...base, disposition: 'spam' })).toEqual({ type: 'spam' });
    expect(planAction({ ...base, disposition: 'review' })).toEqual({ type: 'label', label: 'sift/review' });
  });
});
