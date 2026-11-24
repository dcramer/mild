import { describe, expect, it, vi } from 'vitest';
import type { Browser } from '../fixtures.ts';
import { DAY, HOUR, MINUTE, storeExample } from '../helpers.ts';
import { continueEval, startEval } from '../../src/learn/evals.ts';
import { recordDecision } from '../../src/store/decisions.ts';
import { AT, ME, OTHER, theApp } from './app.ts';
import { everyRouteAnswered } from './areas.ts';

const { fake, settled } = theApp();
const SHOP = 'shop@example.com';
const NEWS = 'news@example.com';
/** A second mailbox of `ME`'s. */
const WORK = 'work@example.org';
const GENERIC = 'Mild could not do that. Why is in its log.';

type Item = { messageId: string; decisionId: number; sender: string; labelId: string; disposition: string };
type Row = {
  id: number;
  messageId: string;
  stage: string;
  disposition: string;
  labelId: string | null;
  carryOut: boolean;
  byUser: boolean;
  actionId: number | null;
  actionStatus: string | null;
};
const itemsOf = async (b: Browser, query = '') => (await b.call('GET', `/api/suggestions${query}`)).body['items'] as Item[];
const rowsOf = async (b: Browser, query = '') => (await b.call('GET', `/api/decisions${query}`)).body['rows'] as Row[];

/** Signed in, with a receipt from `SHOP` and a newsletter from `NEWS`, which the model read as Receipts and Leave in inbox. */
async function waiting() {
  const { sift, box, me, arrives } = await settled();
  const receipt = box.deliver({ from: `Shop <${SHOP}>`, subject: 'Your receipt', text: 'Thanks for your order.' });
  const news = box.deliver({ from: `News <${NEWS}>`, subject: 'This week', headers: { 'List-Id': '<weekly.example.com>' } });
  await arrives();
  const decision = await sift.judged(ME, receipt, 'receipts');
  await sift.judged(ME, news, 'everything_else', 'keep');
  return { sift, box, me, receipt, news, decision };
}

describe('For review', () => {
  it('lists what the model would move, with what it would keep when asked, by sender and by what the mail is', async () => {
    const { me, receipt, news, decision } = await waiting();
    expect(await itemsOf(me)).toMatchObject([{ messageId: receipt, decisionId: decision, sender: SHOP, labelId: 'receipts', disposition: 'archive' }]);
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ waiting: 1, active: false });
    expect((await itemsOf(me, '?kept=1')).map((i) => i.messageId).toSorted()).toEqual([receipt, news].toSorted());
    expect((await itemsOf(me, '?kept=1&fact=list')).map((i) => i.messageId)).toEqual([news]);

    expect((await me.call('GET', `/api/suggestion?sender=${SHOP}`)).body).toMatchObject({
      messages: [{ messageId: receipt, decisionId: decision, labelId: 'receipts' }],
    });
    expect((await me.call('GET', `/api/suggestion?sender=${NEWS}`)).body).toMatchObject({ messages: [{ messageId: news }] });
  });

  it('keeps mail Mild marked for review while on waiting until it is answered, which a rule or a label changing does not do', async () => {
    const { sift, box, me } = await settled();
    await me.call('POST', '/api/active', { active: true });
    const asked = box.deliver({ from: `News <${NEWS}>`, subject: 'Either way' });
    const acted = box.deliver({ from: `Shop <${SHOP}>`, subject: 'Your receipt' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    const db = await sift.db(ME);
    const base = { stage: 'model', subscription: 'preserve', reason: 'The model read it.', confidence: 0.9 } as const;
    await recordDecision(db, ME, asked, { ...base, disposition: 'review' }, { carryOut: true });
    await recordDecision(db, ME, acted, { ...base, disposition: 'archive', labelId: 'receipts' }, { carryOut: true });
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ waiting: 1, items: [{ messageId: asked }] });
    expect(await me.call('POST', '/api/labels', { id: 'receipts', description: 'Receipts and invoices.' })).toMatchObject({ body: { redecided: 0 } });

    sift.queued.length = 0;
    expect((await me.call('POST', '/api/feedback', { accountId: ME, sender: NEWS, label: 'everything_else', messageId: asked })).body).toEqual({
      notFixed: null,
    });
    expect(sift.queued).toContainEqual({ kind: 'pass', person: 1, mailbox: 1 });
    expect((await rowsOf(me)).find((r) => r.messageId === asked)).toMatchObject({
      disposition: 'keep',
      labelId: 'everything_else',
      carryOut: true,
      byUser: true,
    });
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ waiting: 0 });
    await sift.work();
    expect(box.labelsOf(asked)).toEqual(['INBOX', 'UNREAD']);
  });

  it('shows nobody else any of it', async () => {
    const { sift } = await waiting();
    const other = await sift.settled(OTHER);
    expect(await itemsOf(other, '?kept=1')).toEqual([]);
    expect((await other.call('GET', `/api/suggestion?sender=${SHOP}`)).body).toEqual({ messages: [] });
    expect(await rowsOf(other)).toEqual([]);
  });
});

describe('an answer', () => {
  it('that agrees is carried out in Gmail, Mild on or off, and its message kept as an example', async () => {
    const { sift, box, me, receipt, decision } = await waiting();
    const answered = await me.call('POST', '/api/feedback', { accountId: ME, sender: SHOP, label: 'receipts', decisionId: decision, messageId: receipt });
    expect(answered).toMatchObject({ status: 200, body: { notFixed: null } });
    await sift.work();
    expect(box.labelsOf(receipt)).toEqual(['UNREAD', box.labelId('mild/receipts')]);
    expect(await itemsOf(me)).toEqual([]);
    expect((await rowsOf(me))[0]).toMatchObject({ messageId: receipt, byUser: true, carryOut: true, actionStatus: 'done' });
    expect((await me.call('GET', '/api/examples')).body).toMatchObject({
      examples: [{ messageId: receipt, labelId: 'receipts', status: 'captured' }],
      held: { [ME]: 1 },
    });
  });

  it('only recorded, as Inbox gives it, leaves the mail where it is, and can be given again', async () => {
    const { sift, box, me, receipt, decision } = await waiting();
    for (const label of ['receipts', 'everything_else']) {
      const answered = await me.call('POST', '/api/feedback', {
        accountId: ME,
        sender: SHOP,
        label,
        decisionId: decision,
        messageId: receipt,
        carryOut: false,
      });
      expect(answered).toMatchObject({ status: 200, body: { notFixed: null } });
      await sift.work();
      expect(box.labelsOf(receipt)).toEqual(['INBOX', 'UNREAD']);
    }
    expect(await itemsOf(me)).toEqual([]);
    expect((await rowsOf(me))[0]).toMatchObject({ messageId: receipt, labelId: 'everything_else', byUser: true, carryOut: false, actionId: null });
  });

  it('of Leave in inbox keeps mail that Mild had decided to move but not yet moved', async () => {
    const { sift, box, me, receipt } = await waiting();
    await me.call('POST', '/api/active', { active: true });
    // Gmail failed Mild's archive, so it waits for the next pass to try again.
    const mild = await recordDecision(
      await sift.db(ME),
      ME,
      receipt,
      { stage: 'model', disposition: 'archive', labelId: 'receipts', subscription: 'preserve', reason: 'The model read it as Receipts.', confidence: 0.9 },
      { carryOut: true },
    );
    expect((await me.call('POST', '/api/feedback', { accountId: ME, sender: SHOP, label: 'everything_else', messageId: receipt })).status).toBe(200);
    await sift.work();
    expect(box.labelsOf(receipt)).toEqual(['INBOX', 'UNREAD']);
    expect((await rowsOf(me)).find((r) => r.id === mild)).toMatchObject({ actionId: null });
  });

  it('that corrects what Mild did takes its change back in Gmail', async () => {
    const { sift, box, me } = await waiting();
    await me.call('POST', '/api/active', { active: true });
    await me.call('POST', '/api/rules', { match: { from: ['deals@example.com'] }, label: 'receipts' });
    const deal = box.deliver({ from: 'deals@example.com', subject: 'A deal' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    expect(box.labelsOf(deal)).not.toContain('INBOX');

    expect((await me.call('POST', '/api/feedback', { accountId: ME, sender: 'deals@example.com', label: 'everything_else', messageId: deal })).body).toEqual({
      notFixed: null,
    });
    await sift.work();
    expect(box.labelsOf(deal)).toEqual(['UNREAD', 'INBOX']);
    expect(await rowsOf(me, '?status=undone')).toMatchObject([{ messageId: deal, stage: 'rules' }]);
  });

  it('says so when Gmail refuses to take Mild’s change back, keeping the answer', async () => {
    const { sift, box, me } = await waiting();
    await me.call('POST', '/api/active', { active: true });
    await me.call('POST', '/api/rules', { match: { from: ['deals@example.com'] }, label: 'receipts' });
    const deal = box.deliver({ from: 'deals@example.com', subject: 'A deal' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    box.fail('users.messages.modify', { status: 500, reason: 'Backend Error' });

    const answered = await me.call('POST', '/api/feedback', { accountId: ME, sender: 'deals@example.com', label: 'everything_else', messageId: deal });
    expect(answered).toMatchObject({ status: 200, body: { notFixed: expect.stringContaining('Backend Error') } });
    await sift.work();
    expect(box.labelsOf(deal)).not.toContain('INBOX');
    expect((await rowsOf(me))[0]).toMatchObject({ messageId: deal, byUser: true, labelId: 'everything_else' });
  });

  it('says only that it failed when Gmail cannot be reached to take Mild’s change back, keeping the answer', async () => {
    const { sift, box, me } = await waiting();
    await me.call('POST', '/api/active', { active: true });
    await me.call('POST', '/api/rules', { match: { from: ['deals@example.com'] }, label: 'receipts' });
    const deal = box.deliver({ from: 'deals@example.com', subject: 'A deal' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    // Gmail's client tries a read four times before it gives up; the error it gives is Gmail's, not written for the page.
    box.fail('users.messages.get', ...Array.from({ length: 4 }, () => ({ status: 503 })));

    const answered = await me.call('POST', '/api/feedback', { accountId: ME, sender: 'deals@example.com', label: 'everything_else', messageId: deal });
    expect(answered).toMatchObject({ status: 200, body: { notFixed: GENERIC } });
    expect(box.labelsOf(deal)).not.toContain('INBOX');
    expect((await rowsOf(me))[0]).toMatchObject({ messageId: deal, byUser: true, labelId: 'everything_else' });
  });

  it('is refused for someone else’s mailbox', async () => {
    const { sift, me, receipt, decision } = await waiting();
    const other = await sift.settled(OTHER);
    expect(
      (await other.call('POST', '/api/feedback', { accountId: ME, sender: SHOP, label: 'receipts', decisionId: decision, messageId: receipt })).status,
    ).toBe(404);
    expect(await itemsOf(me)).toMatchObject([{ messageId: receipt }]);
  });
});

describe('Activity', () => {
  it('lists every decision in the window newest first, narrowed by where it got to, the words in it and its label', async () => {
    const { sift, box, me, receipt, news } = await waiting();
    const old = box.deliver({ from: 'Old Friend <friend@example.org>', subject: 'Long ago' });
    const kept = box.deliver({ from: 'ada@example.org', subject: 'Hello' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    const db = await sift.db(ME);
    const base = { stage: 'rules', disposition: 'keep', subscription: 'preserve', reason: 'A rule said so.' } as const;
    await recordDecision(db, ME, old, base, { now: AT - 40 * DAY });
    await recordDecision(db, ME, kept, base);
    const ids = async (query: string) => (await rowsOf(me, query)).map((r) => r.messageId);

    expect(await ids('')).toEqual([kept, news, receipt]);
    expect((await me.call('GET', '/api/decisions')).body).toMatchObject({ total: 3 });
    expect(await ids('?days=90')).toEqual([kept, old, news, receipt]);
    expect(await ids('?status=suggested')).toEqual([kept, news, receipt]);
    expect(await rowsOf(me, '?status=done')).toEqual([]);
    expect((await me.call('GET', `/api/decisions?status=${encodeURIComponent("x' OR 1=1 --")}`)).body).toMatchObject({ total: 0 });
    expect(await ids('?label=receipts')).toEqual([receipt]);
    // Leave in inbox takes mail kept with no label too.
    expect(await ids('?label=everything_else')).toEqual([kept, news]);
    expect(await ids('?label=nope')).toEqual([]);
    expect(await ids('?q=shop')).toEqual([receipt]);
    expect(await ids('?days=90&q=old+FRIEND')).toEqual([old]);
    expect((await me.call('GET', `/api/decisions?q=${encodeURIComponent('%')}`)).body).toMatchObject({ total: 0 });
    const paged = await me.call('GET', '/api/decisions?limit=1&offset=1');
    expect(paged.body).toMatchObject({ total: 3 });
    expect((paged.body['rows'] as Row[]).map((r) => r.messageId)).toEqual([news]);
    expect((await me.call('GET', '/api/decisions?days=3')).status).toBe(400);
  });

  it('narrows decisions by what Mild recorded about each message', async () => {
    const { sift, box, me } = await settled();
    const reply = box.deliver({
      from: 'dev@example.org',
      subject: 'Re: the plan',
      headers: { 'In-Reply-To': '<plan@example.org>', 'List-Id': '<dev.example.org>', 'Authentication-Results': 'mx.google.com; dmarc=pass' },
    });
    const plain = box.deliver({
      from: 'ada@example.org',
      subject: 'Files',
      attachments: [{ filename: 'notes.txt', mimeType: 'text/plain', data: Buffer.from('notes').toString('base64') }],
    });
    const forged = box.deliver({ from: 'bank@example.com', subject: 'Your account', headers: { 'Authentication-Results': 'mx.google.com; dmarc=fail' } });
    await me.call('POST', '/api/check', {});
    await sift.work();
    for (const id of [reply, plain, forged]) await sift.judged(ME, id, 'everything_else', 'keep');
    const ids = async (fact: string) => (await rowsOf(me, `?fact=${fact}`)).map((r) => r.messageId);

    expect(await ids('reply')).toEqual([reply]);
    expect(await ids('list')).toEqual([reply]);
    expect(await ids('unproven')).toEqual([forged, plain]);
    // Not known until a model reads the message whole, so nothing matches yet.
    expect(await ids('attachments')).toEqual([]);
    expect(await ids(encodeURIComponent("reply' OR 1=1 --"))).toEqual([]);
  });
});

describe('examples', () => {
  /** `waiting`, with both messages answered and the pass that carries the answers out done, so both are kept as examples. */
  async function answered() {
    const ready = await waiting();
    for (const [sender, label, messageId] of [
      [SHOP, 'receipts', ready.receipt],
      [NEWS, 'everything_else', ready.news],
    ] as const)
      await ready.me.call('POST', '/api/feedback', { accountId: ME, sender, label, messageId });
    await ready.sift.work();
    return ready;
  }

  it('are listed mailbox by mailbox, newest answer first, or for one mailbox, without their content', async () => {
    const { sift, box, me } = await settled();
    await me.signIn(WORK, { add: true });
    await sift.work();
    const work = fake.google.mailbox(WORK);
    const first = box.deliver({ from: `News <${NEWS}>`, subject: 'This week', text: 'Private words.' });
    const second = box.deliver({ from: 'ada@example.org', subject: 'Lunch' });
    const third = box.deliver({ from: 'bo@example.org', subject: 'Dinner' });
    // Each fake mailbox numbers its mail from the same start; this one must not share an id with ME's.
    const theirs = work.deliver({ id: 'b0000000000001', from: 'cy@example.org', subject: 'Standup' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    for (const [n, [accountId, sender, messageId]] of [
      [ME, NEWS, first],
      [ME, 'ada@example.org', second],
      [ME, 'bo@example.org', third],
      [WORK, 'cy@example.org', theirs],
    ].entries()) {
      vi.setSystemTime(AT + HOUR + n * MINUTE);
      await me.call('POST', '/api/feedback', { accountId, sender, label: 'everything_else', messageId });
    }
    await sift.work();

    const all = await me.call('GET', '/api/examples');
    expect(all.body).toMatchObject({ held: { [ME]: 3, [WORK]: 1 } });
    expect((all.body['examples'] as { messageId: string }[]).map((e) => e.messageId)).toEqual([third, second, first, theirs]);
    const listed = await me.call('GET', `/api/examples?mailbox=${encodeURIComponent(ME)}`);
    expect(listed.body['held']).toEqual({ [ME]: 3 });
    expect((listed.body['examples'] as { messageId: string }[]).map((e) => e.messageId)).toEqual([third, second, first]);
    expect((listed.body['examples'] as unknown[])[2]).toEqual({
      accountId: ME,
      messageId: first,
      fromAddress: NEWS,
      fromName: 'News',
      subject: 'This week',
      labelId: 'everything_else',
      markedAt: expect.any(Number),
      status: 'captured',
    });
    expect(JSON.stringify(listed.body)).not.toContain('Private words.');

    expect(await me.call('POST', '/api/examples/delete', { accountId: ME, messageId: first })).toMatchObject({ status: 200, body: { deleted: 1 } });
    expect((await me.call('POST', '/api/examples/delete', { accountId: ME, messageId: first })).body).toEqual({ deleted: 0 });
    expect((await me.call('POST', '/api/examples/delete', { accountId: ME })).status).toBe(400);
    expect((await me.call('POST', '/api/examples/delete-all', { accountId: 'nobody@example.org' })).status).toBe(404);
    expect((await me.call('POST', '/api/examples/delete-all', { accountId: ME })).body).toEqual({ deleted: 2 });
    expect((await me.call('GET', '/api/examples')).body).toMatchObject({ examples: [{ messageId: theirs }], held: { [WORK]: 1 } });
    // The message and what Mild decided about it are its record of what it saw and did; only the stored content goes.
    expect((await me.call('GET', `/api/message?id=${first}`)).body).toMatchObject({ subject: 'This week', decisions: [{ byUser: true }] });
  });

  it('are deleted one at a time or all at once', async () => {
    const { me, receipt, news } = await answered();
    const listed = async () => ((await me.call('GET', '/api/examples')).body['examples'] as { messageId: string }[]).map((e) => e.messageId).toSorted();
    expect(await listed()).toEqual([receipt, news].toSorted());

    expect(await me.call('POST', '/api/examples/delete', { accountId: ME, messageId: receipt })).toMatchObject({ status: 200, body: { deleted: 1 } });
    expect(await listed()).toEqual([news]);
    expect(await me.call('POST', '/api/examples/delete-all', { accountId: ME })).toMatchObject({ status: 200, body: { deleted: 1 } });
    expect((await me.call('GET', '/api/examples')).body).toEqual({ examples: [], held: {} });
  });

  it('are nobody else’s to see or delete', async () => {
    const { sift, me, receipt } = await answered();
    const other = await sift.settled(OTHER);
    expect((await other.call('GET', '/api/examples')).body).toEqual({ examples: [], held: {} });
    expect((await other.call('POST', '/api/examples/delete', { accountId: ME, messageId: receipt })).status).toBe(404);
    expect((await other.call('POST', '/api/examples/delete-all', { accountId: ME })).status).toBe(404);
    expect((await me.call('GET', '/api/examples')).body).toMatchObject({ held: { [ME]: 2 } });
  });

  it('are replayed only when asked, the fifty newest unless told how many, and show what the model got for each', async () => {
    const { sift, me } = await settled();
    const db = await sift.db(ME);
    for (let n = 0; n < 51; n++) await storeExample(db, ME, { id: `e${n}`, from: NEWS, label: 'receipts', markedAt: n });
    expect((await me.call('GET', '/api/evals')).body).toEqual({ runs: [], examples: { [ME]: 51 }, defaultLimit: 50, maxLimit: 200 });
    expect(sift.queued.filter((w) => w.kind === 'eval')).toEqual([]);

    // What a test run does with the model, as the work it begins would do it: a pass here has no model of its own.
    const given = { db, judge: async () => ({ label: 'everything_else', reason: 'r' }), model: 'test/model' };
    const finished = await startEval(given, { accountId: ME, fewShot: false, limit: 1 });
    await continueEval(given, finished, Infinity);
    expect((await me.call('GET', '/api/evals')).body['runs']).toMatchObject([
      { id: finished, model: 'test/model', status: 'done', fewShot: false, score: { total: 1, wrong: 1 } },
    ]);
    expect((await me.call('GET', `/api/eval?id=${finished}`)).body).toMatchObject({
      run: { id: finished },
      results: [{ messageId: 'e50', expected: 'receipts', got: 'everything_else', subject: 'Subject e50' }],
    });
    expect((await me.call('GET', '/api/eval?id=99')).status).toBe(404);

    await me.call('POST', '/api/model/key', { provider: 'anthropic', key: 'sk-ant-test' });
    await me.call('POST', '/api/model', { model: 'anthropic/claude-sonnet-4-5' });
    for (const bad of [{}, { accountId: ME, limit: 201 }, { accountId: ME, limit: 0 }, { accountId: ME, fewShot: 1 }])
      expect((await me.call('POST', '/api/evals/run', bad)).status).toBe(400);
    expect((await me.call('POST', '/api/evals/run', { accountId: 'nobody@example.org' })).status).toBe(404);
    const run = await me.call('POST', '/api/evals/run', { accountId: ME });
    expect(run.body).toEqual({ id: expect.any(Number) });
    const { id } = run.body as { id: number };
    expect(sift.queued).toContainEqual({ kind: 'eval', person: 1, run: id });
    expect((await me.call('GET', `/api/eval?id=${id}`)).body).toMatchObject({ run: { id, fewShot: true, total: 50 } });
  });

  it('are what a test run replays, on the person’s own model, which it refuses without one', async () => {
    const { sift, me } = await answered();
    expect((await me.call('GET', '/api/evals')).body).toMatchObject({ runs: [], examples: { [ME]: 2 } });
    expect(await me.call('POST', '/api/evals/run', { accountId: ME })).toMatchObject({ status: 409, body: { error: 'Choose a model first.' } });

    await me.call('POST', '/api/model/key', { provider: 'anthropic', key: 'sk-ant-test' });
    await me.call('POST', '/api/model', { model: 'anthropic/claude-sonnet-4-5' });
    const run = await me.call('POST', '/api/evals/run', { accountId: ME, fewShot: false, limit: 1 });
    expect(run).toMatchObject({ status: 200, body: { id: expect.any(Number) } });
    const { id } = run.body as { id: number };
    expect(sift.queued).toContainEqual({ kind: 'eval', person: 1, run: id });
    expect((await me.call('GET', '/api/evals')).body).toMatchObject({ runs: [{ id, accountId: ME, model: 'anthropic/claude-sonnet-4-5', fewShot: false }] });
    expect((await me.call('GET', `/api/eval?id=${id}`)).body).toMatchObject({ run: { id, total: 1 } });

    const other = await sift.settled(OTHER);
    expect((await other.call('GET', `/api/eval?id=${id}`)).status).toBe(404);
    expect((await other.call('GET', '/api/evals')).body).toMatchObject({ runs: [] });
    expect((await other.call('POST', '/api/evals/run', { accountId: ME })).status).toBe(404);
  });
});

everyRouteAnswered('review');
