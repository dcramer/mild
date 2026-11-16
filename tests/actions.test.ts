import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ActionDeps, execute, reconcile, undo } from '../src/actions/executor.ts';
import { planAction } from '../src/actions/plan.ts';
import { addMailbox, recordSync } from '../src/store/accounts.ts';
import { getAction } from '../src/store/actions.ts';
import { openUserDb, raw } from './fixtures.ts';
import { FakeMailbox, facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';

let db: Sql;
let mailbox: FakeMailbox;
let deps: ActionDeps;

beforeEach(async () => {
  db = await openUserDb(ACCOUNT);
  await addMailbox(db, ACCOUNT, '1', 0);
  await recordSync(db, ACCOUNT, [facts({ messageId: 'm1' })], '2');
  mailbox = new FakeMailbox();
  mailbox.labels.set('m1', ['INBOX', 'UNREAD', 'L:mine']);
  deps = { db, mailbox, now: () => 1000 };
});

describe('execute', () => {
  it('archives with an audit label, preserving unread state and other labels', async () => {
    const outcome = await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    expect(outcome).toMatchObject({ status: 'done', finalLabels: ['UNREAD', 'L:mine', 'L:sift/did/archived'] });
    const action = await getAction(db, 1);
    expect(action).toMatchObject({
      type: 'archive',
      status: 'done',
      originalLabels: ['INBOX', 'UNREAD', 'L:mine'],
      payload: { add: ['L:sift/did/archived'], remove: ['INBOX'] },
    });
  });

  it('adds both labels when archiving: what the mail is, and what sift did', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive', labels: ['sift/newsletters'] });
    expect(mailbox.labels.get('m1')).toEqual(['UNREAD', 'L:mine', 'L:sift/newsletters', 'L:sift/did/archived']);
  });

  it('labels without moving the message', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'label', labels: ['sift/review'] });
    expect(mailbox.labels.get('m1')).toEqual(['INBOX', 'UNREAD', 'L:mine', 'L:sift/review']);
  });

  it('never touches a message that is not in the inbox or no longer exists', async () => {
    mailbox.labels.set('m1', ['UNREAD']);
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'archive' })).toEqual({ status: 'skipped', reason: 'message is not in the inbox' });
    expect(await execute(deps, ACCOUNT, 'gone', { type: 'archive' })).toEqual({ status: 'skipped', reason: 'message no longer exists' });
    expect(mailbox.modifyCalls).toBe(0);
    expect(await raw(db).get('SELECT count(*) AS n FROM actions')).toEqual({ n: 0 });
  });

  it('skips when the message already has the label', async () => {
    mailbox.labels.set('m1', ['INBOX', 'L:sift/review']);
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'label', labels: ['sift/review'] })).toMatchObject({ status: 'skipped' });
    expect(mailbox.modifyCalls).toBe(0);
  });

  it('marks spam with an audit label', async () => {
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'spam' })).toMatchObject({ status: 'done' });
    expect(mailbox.labels.get('m1')).toEqual(['UNREAD', 'L:mine', 'L:sift/did/spam', 'SPAM']);
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
    expect((await getAction(db, 1))?.status).toBe('unknown');

    mailbox.failModify = null;
    expect(await reconcile(deps)).toBe(1);
    expect(await getAction(db, 1)).toMatchObject({ status: 'done', finalLabels: ['UNREAD', 'L:mine', 'L:sift/did/archived'] });
    expect(mailbox.modifyCalls).toBe(1);
  });

  it('settles a change that never landed as failed, and the next execute starts clean', async () => {
    mailbox.failModify = 'before';
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'archive' })).toMatchObject({ status: 'unknown' });

    mailbox.failModify = null;
    expect(await execute(deps, ACCOUNT, 'm1', { type: 'archive' })).toMatchObject({ status: 'done', actionId: 2 });
    expect(await getAction(db, 1)).toMatchObject({ status: 'failed', error: 'network down' });
  });

  it('settles a crash that left an action pending', async () => {
    await raw(db).run(
      `INSERT INTO actions (account_id, message_id, type, payload, original_labels, status, created_at) VALUES (?, 'm1', 'archive', ?, '["INBOX"]', 'pending', 0)`,
      ACCOUNT,
      JSON.stringify({ add: ['L:sift/did/archived'], remove: ['INBOX'] }),
    );
    await reconcile(deps);
    expect(await getAction(db, 1)).toMatchObject({ status: 'failed', error: 'change was not applied' });
  });
});

describe('marking read', () => {
  it('marks read while archiving or keeping, and undo puts unread back', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive', labels: ['sift/newsletters'], markRead: true });
    expect(mailbox.labels.get('m1')).toEqual(['L:mine', 'L:sift/newsletters', 'L:sift/did/archived']);
    await undo(deps, 1);
    expect(mailbox.labels.get('m1')?.toSorted()).toEqual(['INBOX', 'L:mine', 'UNREAD']);

    await execute(deps, ACCOUNT, 'm1', { type: 'label', markRead: true });
    expect(mailbox.labels.get('m1')?.toSorted()).toEqual(['INBOX', 'L:mine']);
  });

  it('never marks spam read', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'spam', markRead: true });
    expect(mailbox.labels.get('m1')).toContain('UNREAD');
  });
});

describe('undo', () => {
  it('restores the inbox and removes what was added', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'spam' });
    expect(await undo(deps, 1)).toMatchObject({ status: 'done', actionId: 2 });
    expect(mailbox.labels.get('m1')?.toSorted()).toEqual(['INBOX', 'L:mine', 'UNREAD']);
    expect((await getAction(db, 1))?.status).toBe('undone');
    expect(await getAction(db, 2)).toMatchObject({ type: 'undo', status: 'done', payload: { undoOf: 1 } });
  });

  it('keeps changes the user made afterwards', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    mailbox.labels.set('m1', ['INBOX', 'L:sift/did/archived', 'L:later']);
    await undo(deps, 1);
    expect(mailbox.labels.get('m1')).toEqual(['INBOX', 'L:later']);
  });

  it('marks the action undone when the user already reversed it by hand', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    mailbox.labels.set('m1', ['INBOX']);
    expect(await undo(deps, 1)).toMatchObject({ status: 'skipped' });
    expect((await getAction(db, 1))?.status).toBe('undone');
  });

  it('refuses to undo twice, to undo an undo, or to touch trashed mail', async () => {
    await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    await undo(deps, 1);
    await expect(undo(deps, 1)).rejects.toThrow(/is undone/);
    await expect(undo(deps, 2)).rejects.toThrow(/itself an undo/);
    await expect(undo(deps, 99)).rejects.toThrow(/no change #99/);

    await execute(deps, ACCOUNT, 'm1', { type: 'archive' });
    mailbox.labels.set('m1', ['TRASH']);
    await expect(undo(deps, 3)).rejects.toThrow(/trash/);
  });
});

describe('planAction', () => {
  const base = { subscription: 'preserve', stage: 'rules', reason: '' } as const;

  it('maps decisions to actions, always carrying the label for what the mail is', () => {
    expect(planAction({ ...base, disposition: 'keep' })).toBeNull();
    expect(planAction({ ...base, disposition: 'keep', gmailLabel: 'sift/personal' })).toEqual({ type: 'label', labels: ['sift/personal'] });
    expect(planAction({ ...base, disposition: 'archive', gmailLabel: 'sift/news' })).toEqual({ type: 'archive', labels: ['sift/news'] });
    expect(planAction({ ...base, disposition: 'spam', gmailLabel: 'sift/junk' })).toEqual({ type: 'spam', labels: ['sift/junk'] });
    expect(planAction({ ...base, disposition: 'review' })).toEqual({ type: 'label', labels: ['sift/review'] });
    expect(planAction({ ...base, disposition: 'keep', markRead: true })).toEqual({ type: 'label', labels: [], markRead: true });
    expect(planAction({ ...base, disposition: 'archive', gmailLabel: 'sift/news', markRead: true })).toEqual({
      type: 'archive',
      labels: ['sift/news'],
      markRead: true,
    });
    expect(planAction({ ...base, disposition: 'review', gmailLabel: 'sift/cold-outreach' })).toEqual({
      type: 'label',
      labels: ['sift/cold-outreach', 'sift/review'],
    });
  });
});
