import { describe, expect, it, vi } from 'vitest';
import { REACH, goingInboxRuns } from '../../src/store/inbox-runs.ts';
import { continueInboxRun } from '../../src/work/inbox-runs.ts';
import { type Browser, connectGmail, firstAccount, modelRun, raw } from '../fixtures.ts';
import { DAY, UNSURE, testModel } from '../helpers.ts';
import { AT, ME, OTHER, theApp } from './app.ts';
import { everyRouteAnswered } from './areas.ts';

const { fake, start, settled } = theApp();
const WORK = 'me@work.example.com';
const SHOP = 'shop@example.com';

const manage = async (b: Browser) => (await b.call('GET', '/api/manage')).body;

/** Signed in, with a rule that says mail from `SHOP` is a receipt. */
async function withRule() {
  const app = await settled();
  await app.me.call('POST', '/api/rules', { match: { from: [SHOP] }, label: 'receipts' });
  /** Mail from `SHOP`, as the next pass brings it. */
  const receipt = async () => {
    const id = app.box.deliver({ from: `Shop <${SHOP}>`, subject: 'Your receipt' });
    await app.arrives();
    return id;
  };
  return { ...app, receipt };
}

describe('how Mild is set up', () => {
  it('shows whether it is on, its mailboxes and labels, and which mailbox’s Google sign-in has expired', async () => {
    const { sift, me } = await settled();
    const shown = await manage(me);
    expect(shown).toMatchObject({ active: false, activity: { running: true, expired: [] }, accounts: [{ id: ME }] });
    expect(shown['labels']).toContainEqual(
      expect.objectContaining({ id: 'receipts', gmailLabel: 'mild/receipts', rules: 0, messages: 0, record: { reviewed: 0, right: 0 } }),
    );

    for (const [token, grant] of fake.google.save().grants) if (grant.address === ME) fake.google.expire(token);
    await me.call('POST', '/api/check', {});
    await sift.work();
    expect(await manage(me)).toMatchObject({ activity: { running: true, expired: [ME] } });
  });
});

describe('Mild on and off', () => {
  it('checks Gmail each time it is turned on or off, and Suggestions says which it is, since that changes what its rows mean', async () => {
    const { sift, box, me } = await settled();
    for (const active of [true, false]) {
      box.requests.length = 0;
      expect((await me.call('POST', '/api/active', { active })).status).toBe(200);
      await sift.work();
      expect(box.asked('users.history.list')).not.toEqual([]);
      expect(await manage(me)).toMatchObject({ active });
      expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ active });
    }
    for (const bad of [{}, { active: 'yes' }, { active: true, interval: 60 }]) expect((await me.call('POST', '/api/active', bad)).status).toBe(400);
    expect(await manage(me)).toMatchObject({ active: false });
  });

  it('only suggests while off, and carries out what it decides in Gmail once on', async () => {
    const { box, me, receipt } = await withRule();
    const suggested = await receipt();
    expect(box.labelsOf(suggested)).toEqual(['INBOX', 'UNREAD']);
    expect(box.asked('users.messages.modify')).toEqual([]);

    expect((await me.call('POST', '/api/active', { active: true })).status).toBe(200);
    expect(await manage(me)).toMatchObject({ active: true });
    const done = await receipt();
    expect(box.labelsOf(done)).toEqual(['UNREAD', box.labelId('mild/receipts')]);
    expect(box.labelsOf(suggested)).toEqual(['INBOX', 'UNREAD']);

    await me.call('POST', '/api/active', { active: false });
    expect(box.labelsOf(await receipt())).toEqual(['INBOX', 'UNREAD']);
  });

  it('checks Gmail now when asked, and counts what was decided and what it saved', async () => {
    const { sift, box, me, receipt } = await withRule();
    await me.call('POST', '/api/active', { active: true });
    box.requests.length = 0;
    const id = await receipt();
    expect(box.asked('users.history.list')).not.toEqual([]);
    await modelRun(await sift.db(ME), { messageId: id, at: AT - 2 * DAY, usage: { model: 'p/m', inputTokens: 10, outputTokens: 5, costUsd: 0.25 } });

    const summary = (await me.call('GET', '/api/summary?days=7')).body;
    expect(summary).toMatchObject({
      days: 7,
      totals: { messages: 1, decided: 1, withoutInference: 1 },
      byDisposition: [{ disposition: 'archive', decisions: 1 }],
    });
    expect((summary['daily'] as { day: string; counts: { rules: number } }[]).at(-1)).toMatchObject({ day: '2026-11-18', counts: { rules: 1 } });
    const labelledToday = async (label: string) =>
      ((await me.call('GET', `/api/summary?days=7&label=${label}`)).body['daily'] as { labelled: number }[]).at(-1)!.labelled;
    expect(await labelledToday('receipts')).toBe(1);
    expect(await labelledToday('everything_else')).toBe(0);
    expect((await me.call('GET', '/api/summary?days=2')).status).toBe(400);

    const usage = (await me.call('GET', '/api/usage')).body;
    expect(usage).toMatchObject({ day: 0, week: 0.25, month: 0.25, saved: { day: { messages: 1 } } });

    vi.setSystemTime(AT + 20 * DAY);
    const recent = async (days: number) => (await me.call('GET', `/api/summary?days=${days}`)).body;
    expect(await recent(30)).toMatchObject({ days: 30, recent: [{ messageId: id }] });
    expect(await recent(7)).toMatchObject({ recent: [] });
  });

  it('shows nobody else what it decided, or what it cost', async () => {
    const { sift, me, receipt } = await withRule();
    await modelRun(await sift.db(ME), { messageId: await receipt(), at: AT, usage: { model: 'p/m', inputTokens: 10, outputTokens: 5, costUsd: 0.25 } });
    expect((await me.call('GET', '/api/summary')).body).toMatchObject({ totals: { decided: 1 } });
    const other = await sift.settled(OTHER);
    expect((await other.call('GET', '/api/summary')).body).toMatchObject({ totals: { messages: 0, decided: 0 } });
    expect((await other.call('GET', '/api/usage')).body).toMatchObject({ day: 0, month: 0 });
    expect(await manage(other)).toMatchObject({ owner: false, accounts: [{ id: OTHER }] });
  });
});

describe('the digest', () => {
  it('arrives at the hour the person chose, in their zone', async () => {
    const { me } = await withRule();
    expect((await me.call('POST', '/api/digest', { hour: 18, timeZone: 'Europe/Paris' })).status).toBe(200);
    expect(await manage(me)).toMatchObject({ digest: { hour: 18, timeZone: 'Europe/Paris' } });
    expect((await me.call('POST', '/api/digest', { hour: 18, timeZone: 'Mars/Olympus' })).status).toBe(400);
    expect(await manage(me)).toMatchObject({ digest: { timeZone: 'Europe/Paris' } });
  });
});

describe('going through the inbox', () => {
  it('says what it would take from Gmail’s count, as far as it was asked to reach, asked once a while', async () => {
    const sift = await start();
    const box = fake.google.mailbox(ME);
    const inbox = REACH.recent + 1;
    for (let i = 0; i < inbox; i++) box.deliver({ from: `sender${i}@example.com` }, { quietly: true });
    box.deliver({ from: 'archived@example.com', labelIds: [] }, { quietly: true });
    const me = await sift.settled(ME);

    expect(await me.call('GET', '/api/inbox?reach=inbox')).toMatchObject({ status: 200, body: { messages: inbox, model: inbox, cost: null } });
    expect((await me.call('GET', '/api/inbox?reach=recent')).body).toEqual({ messages: REACH.recent, model: REACH.recent, cost: null });
    expect(box.asked('users.labels.get')).toEqual([{ method: 'users.labels.get', id: 'INBOX' }]);
  });

  it('is started for each mailbox of the person, once at a time, and acts only if Mild was on at the press', async () => {
    const { sift, me } = await settled();
    await me.signIn(WORK, { add: true });
    await sift.work();
    const runs = async () => await raw(await sift.db(ME)).all('SELECT account_id, acts, most, stopped FROM inbox_runs ORDER BY id');

    expect((await me.call('POST', '/api/inbox/start', { reach: 'recent' })).body).toEqual({ ok: true });
    expect(new Set(sift.queued.flatMap((w) => (w.kind === 'inbox' ? [w.mailbox] : [])))).toHaveProperty('size', 2);
    expect(await me.call('POST', '/api/inbox/start', { reach: 'inbox' })).toMatchObject({ status: 409 });
    expect(await runs()).toEqual([
      { account_id: ME, acts: false, most: REACH.recent, stopped: false },
      { account_id: WORK, acts: false, most: REACH.recent, stopped: false },
    ]);
    expect((await me.call('POST', '/api/inbox/stop', {})).body).toEqual({ ok: true });

    await me.call('POST', '/api/active', { active: true });
    await me.call('POST', '/api/inbox/start', { reach: 'inbox' });
    expect(await runs()).toEqual([
      { account_id: ME, acts: false, most: REACH.recent, stopped: true },
      { account_id: WORK, acts: false, most: REACH.recent, stopped: true },
      { account_id: ME, acts: true, most: REACH.inbox, stopped: false },
      { account_id: WORK, acts: true, most: REACH.inbox, stopped: false },
    ]);
  });

  it('says where it has got, what it has spent, and that more suggestions are coming', async () => {
    const { sift, box, me } = await settled();
    const importing = async () => (await me.call('GET', '/api/suggestions')).body['importing'];
    expect(await importing()).toBe(false);
    for (let i = 0; i < 5; i++) box.deliver({ from: 'News <news@example.com>', subject: `Issue ${i}` }, { quietly: true });
    const pressed = Date.now();
    await me.call('POST', '/api/inbox/start', { reach: 'recent' });
    expect(await importing()).toBe(true);

    // A pass under startSift has no model, so its pieces of the run wait: the run goes on here as they would.
    const db = await sift.db(ME);
    const [run] = await goingInboxRuns(db);
    const gmail = connectGmail(fake.google);
    let clock = Date.now();
    const goOn = async (until?: number) =>
      await continueInboxRun(
        {
          db,
          api: gmail.api,
          mailbox: null,
          answers: gmail.mailbox,
          sources: gmail,
          model: testModel(async () => ((clock += 10), UNSURE)),
          now: () => clock,
          ...(until === undefined ? {} : { until }),
        },
        await firstAccount(db),
        run!.id,
      );
    await goOn(clock + 15);
    await raw(db).run('UPDATE model_runs SET cost_usd = 0.01 WHERE id IN (SELECT id FROM model_runs ORDER BY id LIMIT 2)');
    const { inbox } = (await manage(me)) as { inbox: { going: { startedAt: number } } };
    expect(inbox).toMatchObject({ going: { listed: true, done: 4, total: 5, spent: 0.02 }, last: null });
    expect(inbox.going.startedAt).toBeGreaterThanOrEqual(pressed);
    expect(await importing()).toBe(true);

    await goOn();
    expect(await importing()).toBe(false);
    expect(await manage(me)).toMatchObject({ inbox: { going: null, last: { total: 5, spent: 0.02, stopped: false } } });
  });

  it('starts once, shows how far it has gone, and stops when asked', async () => {
    const { me } = await withRule();
    expect((await me.call('POST', '/api/inbox/start', { reach: 'recent' })).status).toBe(200);
    expect(await manage(me)).toMatchObject({ inbox: { going: { done: 0 } } });
    expect(await me.call('POST', '/api/inbox/start', { reach: 'recent' })).toMatchObject({
      status: 409,
      body: { error: 'Mild is already going through your inbox.' },
    });

    expect((await me.call('POST', '/api/inbox/stop', {})).status).toBe(200);
    expect(await manage(me)).toMatchObject({ inbox: { going: null, last: { stopped: true } } });
    expect((await me.call('POST', '/api/inbox/start', { reach: 'recent' })).status).toBe(200);
  });

  it('stops nobody else’s', async () => {
    const { sift, me } = await withRule();
    await me.call('POST', '/api/inbox/start', { reach: 'recent' });
    const other = await sift.settled(OTHER);
    await other.call('POST', '/api/inbox/stop', {});
    expect(await manage(me)).toMatchObject({ inbox: { going: { done: 0 } } });
  });
});

describe('mailboxes', () => {
  it('are added by signing in, made primary, and removed with their access revoked at Google', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    await me.signIn(WORK, { add: true });
    expect((await manage(me))['accounts']).toMatchObject([
      { id: ME, primary: true },
      { id: WORK, primary: false },
    ]);

    expect((await me.call('POST', '/api/mailbox/primary', { address: WORK })).status).toBe(200);
    expect((await manage(me))['accounts']).toMatchObject([
      { id: ME, primary: false },
      { id: WORK, primary: true },
    ]);

    expect(fake.google.grantsFor(WORK)).toBe(1);
    expect(await me.call('POST', '/api/mailbox/remove', { address: WORK })).toMatchObject({ status: 200, body: { notRevoked: [], signedOut: false } });
    expect(fake.google.grantsFor(WORK)).toBe(0);
    expect((await manage(me))['accounts']).toMatchObject([{ id: ME, primary: true }]);
    expect(await me.call('POST', '/api/mailbox/remove', { address: ME })).toMatchObject({
      status: 409,
      body: { error: expect.stringContaining('only remaining mailbox') },
    });
  });

  it('are nobody else’s to change', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    await me.signIn(WORK, { add: true });
    const other = await sift.settled(OTHER);
    expect((await other.call('POST', '/api/mailbox/primary', { address: WORK })).status).toBe(404);
    expect((await other.call('POST', '/api/mailbox/remove', { address: WORK })).status).toBe(404);
    expect(fake.google.grantsFor(WORK)).toBe(1);
    expect((await manage(me))['accounts']).toMatchObject([{ id: ME, primary: true }, { id: WORK }]);
  });
});

describe('deleting the account', () => {
  it('takes confirming with one of its addresses, revokes every mailbox at Google and ends the session', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    await me.signIn(WORK, { add: true });
    expect(await me.call('POST', '/api/account/delete', { address: OTHER })).toMatchObject({ status: 409 });

    expect(await me.call('POST', '/api/account/delete', { address: WORK })).toMatchObject({ status: 200, body: { notRevoked: [], signedOut: true } });
    expect(fake.google.grantsFor(ME) + fake.google.grantsFor(WORK)).toBe(0);
    expect((await me.call('GET', '/api/manage')).status).toBe(401);

    const again = await sift.signedIn(ME);
    expect(await manage(again)).toMatchObject({ labels: [{ id: 'everything_else' }], accounts: [{ id: ME }] });
  });
});

everyRouteAnswered('settings');
