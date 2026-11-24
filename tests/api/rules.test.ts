import { describe, expect, it, vi } from 'vitest';
import type { DecisionRow, RuleSummary } from '../../src/dashboard/types.ts';
import { FILL_TOOL, FIND_TOOL } from '../../src/prompts/rule-draft.ts';
import { recordDecision, settleDecision } from '../../src/store/decisions.ts';
import { plain } from '../../src/plain.ts';
import { addRule } from '../../src/store/rules.ts';
import { FILTER_CHECK_MINUTES } from '../../src/work/filters.ts';
import { triageAccount } from '../../src/work/triage.ts';
import { type Browser, type FauxModel, connectGmail, fauxModel, firstAccount, modelRun, raw } from '../fixtures.ts';
import { DAY, testModel, toolReply } from '../helpers.ts';
import { AT, ME, OTHER, theApp } from './app.ts';
import { everyRouteAnswered } from './areas.ts';

const { fake, start, settled } = theApp();
const NEWS = 'news@example.com';

const rulesOf = async (b: Browser) => (await b.call('GET', '/api/rules')).body['rules'] as RuleSummary[];
const waitingOn = async (b: Browser, id: string) =>
  (await b.call('GET', `/api/rules/waiting?id=${id}`)).body as { total: number; messages: { messageId: string }[] };
const latestOf = async (b: Browser, messageId: string) => ((await b.call('GET', `/api/message?id=${messageId}`)).body['decisions'] as DecisionRow[]).at(-1);
const addLabels = async (b: Browser, ...labels: { name: string; disposition: string; unsubscribe?: boolean }[]) =>
  expect((await b.call('POST', '/api/labels/add', { labels: labels.map((l) => ({ description: '', ...l })) })).status).toBe(200);

/** Signed in, with mail from `NEWS` the pass recorded and the model read as Receipts, waiting on them. */
async function waiting(model?: FauxModel) {
  const app = await settled(model);
  const news = app.box.deliver({ from: `News <${NEWS}>`, subject: 'This week' });
  await app.arrives();
  await app.sift.judged(ME, news, 'receipts');
  return { ...app, news };
}

describe('making a rule', () => {
  it('decides the mail waiting that it matches, which the rule then lists, and counts what it decided by day', async () => {
    const { me, news } = await waiting();
    const made = await me.call('POST', '/api/rules', { match: { from: [NEWS] }, disposition: 'keep' });
    expect(made).toMatchObject({ status: 200, body: { replaced: false, redecided: 1, filter: null } });
    const { id } = made.body as { id: string };

    expect(await rulesOf(me)).toMatchObject([{ id, match: { from: [NEWS] }, disposition: 'keep', hits: 1 }]);
    expect(await waitingOn(me, id)).toMatchObject({ total: 1, messages: [{ messageId: news }] });
    const usage = (await me.call('GET', `/api/rules/usage?id=${id}`)).body as { daily: { day: string; changed: number; left: number }[] };
    expect(usage.daily.at(-1)).toEqual({ day: '2026-11-18', changed: 0, left: 1, costUsd: 0 });
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ items: [] });
  });

  it('replaces the rule with exactly its conditions, and refuses one that names a sender by name alone', async () => {
    const { me } = await waiting();
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, disposition: 'keep' })).body as { id: string };
    expect((await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body).toMatchObject({ id, replaced: true });
    expect(await rulesOf(me)).toMatchObject([{ id, labelId: 'receipts' }]);
    expect((await me.call('POST', '/api/rules', { match: { fromName: ['News'] }, disposition: 'archive' })).status).toBe(400);
    expect(await rulesOf(me)).toHaveLength(1);
  });

  it('changes what a rule says in place, and removing it hands its mail back to what the model said', async () => {
    const { me, news } = await waiting();
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, disposition: 'keep' })).body as { id: string };

    expect((await me.call('POST', '/api/rules/edit', { id, match: { from: [NEWS] }, disposition: 'spam' })).status).toBe(200);
    expect(await rulesOf(me)).toMatchObject([{ id, disposition: 'spam' }]);
    expect(await waitingOn(me, id)).toMatchObject({ total: 1 });

    expect(await me.call('POST', '/api/rules/remove', { id })).toMatchObject({ status: 200, body: { redecided: 1 } });
    expect(await rulesOf(me)).toEqual([]);
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ items: [{ messageId: news, labelId: 'receipts', stage: 'model' }] });
  });

  it('changes in place, keeping its place, exceptions and hits, and never into a twin of another', async () => {
    const { sift, box, me, arrives } = await settled();
    const { id: first } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    const id = await addRule(
      await sift.db(ME),
      { match: { from: ['cold@example.net'] }, except: [{ subjectContains: ['invoice'] }], labelId: 'receipts' },
      'learned',
    );
    box.deliver({ from: 'cold@example.net', subject: 'Hello' });
    const warm = box.deliver({ from: 'warm@example.net', subject: 'Hi' });
    await arrives();
    await sift.judged(ME, warm, 'receipts');
    expect((await rulesOf(me)).find((r) => r.id === id)).toMatchObject({ hits: 1 });
    const before = (await rulesOf(me)).map((r) => r.id);

    const edited = await me.call('POST', '/api/rules/edit', {
      id,
      match: { fromDomain: ['example.net'] },
      disposition: 'archive',
      markRead: true,
      name: 'Cold mail',
    });
    expect(edited.status).toBe(200);
    // Its one hit kept, and one more: the mail from example.net waiting in the inbox, decided again.
    expect((await rulesOf(me)).find((r) => r.id === id)).toMatchObject({
      match: { fromDomain: ['example.net'] },
      except: [{ subjectContains: ['invoice'] }],
      kind: 'action',
      labelId: null,
      disposition: 'archive',
      markRead: true,
      hits: 2,
      source: 'user',
      name: 'Cold mail',
    });
    expect((await rulesOf(me)).map((r) => r.id)).toEqual(before);

    // Another rule's exact conditions would leave which one decides to their order.
    const { id: other } = (await me.call('POST', '/api/rules', { match: { from: ['other@example.com'] }, label: 'receipts' })).body as { id: string };
    expect(await me.call('POST', '/api/rules/edit', { id: other, match: { from: [NEWS] }, disposition: 'keep' })).toMatchObject({
      status: 409,
      body: { error: expect.stringMatching(/Another rule already has exactly these conditions/) },
    });
    expect((await rulesOf(me)).find((r) => r.id === first)).toMatchObject({ labelId: 'receipts', override: null });
    // Waiting for a label, it is a different rule for the same sender.
    expect((await me.call('POST', '/api/rules/edit', { id: other, match: { from: [NEWS] }, whenLabel: 'receipts', disposition: 'keep' })).status).toBe(200);
    expect((await me.call('POST', '/api/rules/edit', { id: 'r-gone', match: { from: ['x@example.com'] }, disposition: 'archive' })).status).toBe(409);
  });

  it('charts what it decided by itself over 30 days, carried out or not, and what the model calls behind it cost', async () => {
    const { sift, box, me, arrives } = await settled();
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts', when: 'only the digests' })).body as { id: string };
    const [u1, u2, u3, u4] = [1, 2, 3, 4].map((n) => box.deliver({ from: NEWS, subject: `Digest ${n}` }));
    // With no model, nothing decides them.
    await arrives();
    const db = await sift.db(ME);
    const now = Date.now();
    const byRule = { disposition: 'archive', subscription: 'preserve', stage: 'model', labelId: 'receipts', ruleId: id, reason: 'rule' } as const;
    const usage = { model: 'test-model', inputTokens: 10, outputTokens: 1, costUsd: 0.004 };
    const run = await modelRun(db, { messageId: u1!, ruleId: id, at: now, usage });
    // A check that found the condition unmet decided nothing for the rule, and still cost.
    await modelRun(db, { messageId: u3!, ruleId: id, at: now, usage });
    await settleDecision(db, await recordDecision(db, ME, u1!, byRule, { now, carryOut: true, runId: run }), 'done');
    await recordDecision(db, ME, u2!, byRule, { now });
    // Older than the chart, and the user's own answer: neither counts.
    await recordDecision(db, ME, u3!, byRule, { now: now - 40 * DAY });
    await recordDecision(db, ME, u4!, byRule, { now, byUser: true });

    const { daily } = (await me.call('GET', `/api/rules/usage?id=${id}`)).body as { daily: { changed: number; left: number; costUsd: number }[] };
    expect(daily).toHaveLength(30);
    expect(daily.at(-1)).toMatchObject({ changed: 1, left: 1, costUsd: 0.008 });
    expect(daily.slice(0, -1).every((day) => day.changed + day.left + day.costUsd === 0)).toBe(true);
  });

  it('settles mail Mild left for review while on, taking back in Gmail the label it guessed, and carries itself out', async () => {
    const { sift, box, me, arrives } = await settled();
    await me.call('POST', '/api/active', { active: true });
    const sale = box.deliver({ from: 'Sales <sales@example.com>', subject: 'A sale' });
    await arrives();
    // The model's guess, as a pass with a model records it while Mild is on; the next pass carries it out.
    const guess = {
      stage: 'model',
      disposition: 'review',
      labelId: 'receipts',
      gmailLabel: 'mild/receipts',
      subscription: 'preserve',
      reason: 'Receipts, but not sure.',
    } as const;
    await recordDecision(await sift.db(ME), ME, sale, guess, { carryOut: true });
    await arrives();
    expect(box.labelsOf(sale)).toEqual(['INBOX', 'UNREAD', box.labelId('mild/receipts')]);

    expect(await me.call('POST', '/api/rules', { match: { from: ['sales@example.com'] }, disposition: 'archive' })).toMatchObject({
      status: 200,
      body: { redecided: 1 },
    });
    expect(box.labelsOf(sale)).toEqual(['INBOX', 'UNREAD']);
    await sift.work();
    expect(box.labelsOf(sale)).toEqual(['UNREAD']);
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ waiting: 0 });
  });

  it('removed, when Mild made it, brings back the mail it decided', async () => {
    const { sift, box, me, arrives } = await settled();
    const id = await addRule(await sift.db(ME), { match: { from: ['blocked@example.com'] }, labelId: 'receipts' }, 'learned');
    const blocked = box.deliver({ from: 'blocked@example.com', subject: 'Hello' });
    await arrives();
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ waiting: 1, items: [{ messageId: blocked, stage: 'rules' }] });

    expect(await me.call('POST', '/api/rules/remove', { id })).toMatchObject({ status: 200, body: { ok: true, redecided: 1 } });
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ waiting: 1, items: [{ messageId: blocked }] });
  });

  it('decides waiting suggestions again as rules and labels change, and says how many', async () => {
    const SALES = 'sales@example.com';
    const { sift, box, me, arrives } = await settled();
    await addLabels(me, { name: 'Marketing', disposition: 'archive' }, { name: 'Newsletters', disposition: 'archive' });
    const reply = box.deliver({ from: SALES, subject: 'Re: the sale', headers: { 'In-Reply-To': '<sale@example.com>' } });
    const sale = box.deliver({ from: SALES, subject: 'A sale' });
    await arrives();
    for (const messageId of [reply, sale]) await sift.judged(ME, messageId, 'marketing');
    const waitingCount = async (query = '') => ((await me.call('GET', `/api/suggestions${query}`)).body as { waiting: number }).waiting;

    expect(await me.call('POST', '/api/labels', { id: 'marketing', disposition: 'keep' })).toMatchObject({ status: 200, body: { ok: true, redecided: 2 } });
    expect(await latestOf(me, reply)).toMatchObject({ stage: 'model', disposition: 'keep', labelId: 'marketing' });

    const rule = await me.call('POST', '/api/rules', { match: { from: [SALES] }, label: 'newsletters' });
    expect(rule.body).toMatchObject({ redecided: 2 });
    expect(await latestOf(me, sale)).toMatchObject({ stage: 'rules', disposition: 'archive', labelId: 'newsletters' });
    expect(await waitingCount()).toBe(0);

    expect((await me.call('POST', '/api/rules/remove', { id: rule.body['id'] })).body).toEqual({ ok: true, redecided: 2 });
    expect(await latestOf(me, sale)).toMatchObject({ stage: 'model', disposition: 'keep', labelId: 'marketing' });
    expect(await waitingCount('?kept=1')).toBe(2);

    const replies = async () => ((await me.call('GET', '/api/suggestions?kept=1&fact=reply')).body as { items: { messageId: string }[] }).items;
    expect((await replies()).map((i) => i.messageId)).toEqual([reply]);
    expect((await me.call('GET', '/api/suggestions?fact=nonsense')).status).toBe(400);
    const keepReplies = await me.call('POST', '/api/rules', { match: { from: [SALES], facts: { isReply: true } }, disposition: 'keep' });
    expect(keepReplies.body).toMatchObject({ redecided: 1 });
    expect(await latestOf(me, reply)).toMatchObject({
      stage: 'rules',
      disposition: 'keep',
      reason: 'rule: from sales@example.com, is a reply: leave it in the inbox',
    });
    expect(await latestOf(me, sale)).toMatchObject({ stage: 'model', disposition: 'keep', labelId: 'marketing' });
  });

  it('keeps only the conditions given, says its name in their place, and refuses one it could not apply', async () => {
    const { box, me } = await settled();
    await addLabels(me, { name: 'Investor updates', disposition: 'keep' }, { name: 'Marketing', disposition: 'archive' });

    const added = await me.call('POST', '/api/rules', {
      // Blank and repeated values are dropped, and a condition left with none.
      match: { fromDomain: ['example.com', ' example.net ', 'EXAMPLE.com', ''], subjectContains: [''] },
      label: 'investor-updates',
    });
    const excepted = await me.call('POST', '/api/rules', { match: { from: ['a@example.com'] }, label: 'marketing', disposition: 'keep' });
    expect(await rulesOf(me)).toMatchObject([
      {
        id: added.body['id'],
        match: { fromDomain: ['example.com', 'example.net'] },
        labelId: 'investor-updates',
        labelName: 'Investor updates',
        source: 'user',
        override: null,
        disposition: 'keep',
      },
      { id: excepted.body['id'], labelId: 'marketing', labelName: 'Marketing', override: 'keep', disposition: 'keep' },
    ]);
    expect((await rulesOf(me))[0]!.match).toEqual({ fromDomain: ['example.com', 'example.net'] });

    // A name is said in place of the conditions; adding the same conditions again with none takes it away.
    const again = { match: { fromDomain: ['example.net', 'example.com'] }, label: 'investor-updates' };
    expect((await me.call('POST', '/api/rules', { ...again, name: ' Investor  mail ' })).body).toMatchObject({ id: added.body['id'], replaced: true });
    expect(await rulesOf(me)).toMatchObject([{ id: added.body['id'], name: 'Investor mail' }, { name: null }]);
    await me.call('POST', '/api/rules', { ...again, name: '' });
    expect(await rulesOf(me)).toMatchObject([{ id: added.body['id'], name: null }, { name: null }]);

    expect((await me.call('POST', '/api/rules', { match: {}, label: 'marketing' })).status).toBe(400);
    expect((await me.call('POST', '/api/rules', { match: { fromName: ['Dependabot'] }, label: 'marketing' })).status).toBe(400);
    const named = await me.call('POST', '/api/rules', { match: { from: ['a@example.com'], fromNameContains: ['bot'] }, label: 'marketing' });
    expect((await rulesOf(me)).find((r) => r.id === named.body['id'])?.match).toEqual({ from: ['a@example.com'], fromNameContains: ['bot'] });
    await me.call('POST', '/api/rules/remove', { id: named.body['id'] });

    const onFacts = await me.call('POST', '/api/rules', {
      match: { fromDomain: ['example.org'], facts: { isReply: false, unsubscribe: ['header', 'none'], category: 'promotions' } },
      disposition: 'archive',
    });
    expect(onFacts.status).toBe(200);
    expect((await rulesOf(me)).find((r) => r.id === onFacts.body['id'])?.match).toEqual({
      fromDomain: ['example.org'],
      facts: { isReply: false, unsubscribe: ['header', 'none'], category: 'promotions' },
    });
    for (const facts of [
      {},
      { isReply: 'yes' },
      { dmarc: 'fail' },
      { trackingPixel: false },
      { category: 'spam' },
      { spf: 'pass' },
      { unsubscribe: ['one-click', 'header'] },
      { listId: 'news.example.com' },
    ])
      expect((await me.call('POST', '/api/rules', { match: { facts }, disposition: 'archive' })).status, JSON.stringify(facts)).toBe(400);
    expect((await me.call('POST', '/api/rules', { match: { body: 'x' }, label: 'marketing' })).status).toBe(400);
    expect((await me.call('POST', '/api/rules', { match: { from: ['a@example.com'] }, label: 'no-such-label' })).status).toBe(409);
    expect((await me.call('POST', '/api/rules', { match: { from: ['a@example.com'] }, label: 'marketing', disposition: 'review' })).status).toBe(400);

    // Gmail kept the filter but its answer was lost, and so was the read back that would have found it: the rule records none.
    await me.call('POST', '/api/rules/remove', { id: excepted.body['id'] });
    await me.call('POST', '/api/active', { active: true });
    box.fail('users.settings.filters.create', 'lost');
    box.failLater('users.settings.filters.list', 1, { status: 400 });
    expect((await me.call('POST', '/api/rules/filter', { id: added.body['id'], on: true })).status).toBe(500);
    expect(box.filters).toHaveLength(1);
    expect(await rulesOf(me)).toMatchObject([{ id: added.body['id'], filterId: null }, {}]);
    // Gmail is still asked as the rule goes, and the filter goes with it.
    expect((await me.call('POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(200);
    expect(box.filters).toEqual([]);
    expect((await me.call('POST', '/api/rules/remove', { id: added.body['id'] })).status).toBe(409);
  });
});

describe('a rule as a Gmail filter', () => {
  it('is written to Gmail only with Mild on, taken out again, and goes with its rule', async () => {
    const { box, me } = await waiting();
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    expect((await me.call('POST', '/api/rules/filter', { id, on: true })).status).toBe(409);
    expect(box.filters).toEqual([]);

    await me.call('POST', '/api/active', { active: true });
    const on = await me.call('POST', '/api/rules/filter', { id, on: true });
    expect(on).toMatchObject({ status: 200, body: { filterId: box.filters[0]?.id, filter: { state: 'active' } } });
    expect(box.filters).toEqual([
      { id: expect.any(String), criteria: { from: NEWS }, action: { addLabelIds: [box.labelId('mild/receipts')], removeLabelIds: ['INBOX'] } },
    ]);
    expect(await rulesOf(me)).toMatchObject([{ id, filterId: box.filters[0]!.id }]);

    expect(await me.call('POST', '/api/rules/filter', { id, on: false })).toMatchObject({ status: 200, body: { filterId: null } });
    expect(box.filters).toEqual([]);
    await me.call('POST', '/api/rules/filter', { id, on: true });
    await me.call('POST', '/api/rules/remove', { id });
    expect(box.filters).toEqual([]);
  });

  it('is listed as possible or why not, refused with Mild off, and goes with its rule with Mild off', async () => {
    const { box, me } = await settled();
    await addLabels(me, { name: 'Phishing', disposition: 'spam' });
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    const { id: spam } = (await me.call('POST', '/api/rules', { match: { from: ['scam@example.com'] }, label: 'phishing' })).body as { id: string };
    const listed = await rulesOf(me);
    expect(listed.find((r) => r.id === id)?.filter).toMatchObject({ state: 'none', possible: true, reason: null });
    expect(listed.find((r) => r.id === spam)?.filter).toMatchObject({ state: 'none', possible: false, reason: 'Gmail filters cannot mark mail as spam.' });

    expect(await me.call('POST', '/api/rules/filter', { id, on: true })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/Mild is off/) } });
    await me.call('POST', '/api/active', { active: true });
    expect((await me.call('POST', '/api/rules/filter', { id, on: true })).body).toMatchObject({
      filterId: box.filters[0]?.id,
      filter: { state: 'active', possible: true },
    });
    expect((await me.call('POST', '/api/rules/filter', { id })).status).toBe(400);
    expect((await me.call('POST', '/api/rules/filter', { id: 7, on: true })).status).toBe(400);

    await me.call('POST', '/api/active', { active: false });
    expect((await me.call('POST', '/api/rules/remove', { id })).status).toBe(200);
    expect(box.filters).toEqual([]);
    expect((await rulesOf(me)).map((r) => r.id)).toEqual([spam]);
  });

  it('is offered with a new rule only when it can be one and Mild is on, and written only when asked', async () => {
    const { box, me } = await settled();
    await addLabels(me, { name: 'Phishing', disposition: 'spam' });
    const add = async (rule: Record<string, unknown>) => (await me.call('POST', '/api/rules', rule)).body['filter'];
    expect(await add({ match: { from: [NEWS] }, label: 'receipts' })).toBeNull();
    await me.call('POST', '/api/active', { active: true });
    expect(await add({ match: { from: ['digest@example.com'] }, label: 'receipts' })).toMatchObject({
      possible: true,
      plan: { criteria: { from: 'digest@example.com' }, gmailLabel: 'mild/receipts', archive: true },
    });
    expect(await add({ match: { from: ['scam@example.com'] }, label: 'phishing' })).toBeNull();
    expect(await add({ match: { from: ['shop@example.com'] }, label: 'receipts', when: 'it is a sale' })).toBeNull();
    expect(box.asked('users.settings.filters.create')).toEqual([]);
  });

  it('is brought into line with its rule in Gmail at the next look after the rule changed', async () => {
    const { box, me, arrives } = await waiting();
    await me.call('POST', '/api/active', { active: true });
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    await me.call('POST', '/api/rules/filter', { id, on: true });
    await me.call('POST', '/api/rules/edit', { id, match: { from: [NEWS] }, label: 'receipts', disposition: 'keep' });

    vi.setSystemTime(Date.now() + FILTER_CHECK_MINUTES * 60_000);
    await arrives();
    expect(box.filters).toEqual([{ id: expect.any(String), criteria: { from: NEWS }, action: { addLabelIds: [box.labelId('mild/receipts')] } }]);
  });

  it('is refused when Gmail refuses it, with nothing recorded, and written when tried again', async () => {
    const { box, me } = await waiting();
    await me.call('POST', '/api/active', { active: true });
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    box.fail('users.settings.filters.create', { status: 500 });

    expect((await me.call('POST', '/api/rules/filter', { id, on: true })).status).toBe(500);
    expect(box.filters).toEqual([]);
    expect(await rulesOf(me)).toMatchObject([{ id, filterId: null }]);
    expect((await me.call('POST', '/api/rules/filter', { id, on: true })).status).toBe(200);
    expect(box.filters).toHaveLength(1);
  });

  it('is found in Gmail when the answer to writing it was lost, rather than written twice, and goes with its rule', async () => {
    const { box, me } = await waiting();
    await me.call('POST', '/api/active', { active: true });
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    box.fail('users.settings.filters.create', 'lost');

    expect(await me.call('POST', '/api/rules/filter', { id, on: true })).toMatchObject({ status: 200, body: { filterId: box.filters[0]?.id } });
    expect(box.filters).toHaveLength(1);
    expect((await me.call('POST', '/api/rules/filter', { id, on: true })).status).toBe(200);
    expect(box.filters).toHaveLength(1);
    await me.call('POST', '/api/rules/remove', { id });
    expect(box.filters).toEqual([]);
  });
});

describe('the list of rules', () => {
  it('says what each says, what it decided and the filter it could be', async () => {
    const { box, me, arrives } = await settled();
    await addLabels(me, { name: 'Cold outreach', disposition: 'archive', unsubscribe: true });
    const { id } = (await me.call('POST', '/api/rules', { match: { fromDomain: ['example.com'] }, label: 'cold-outreach' })).body as { id: string };
    const pitch = box.deliver({ from: 'pitch@example.com', subject: 'Quick question' });
    await arrives();
    const decided = await latestOf(me, pitch);
    expect(decided).toMatchObject({ stage: 'rules', ruleId: id });

    expect(await rulesOf(me)).toEqual([
      {
        id,
        match: { fromDomain: ['example.com'] },
        except: [],
        labelId: 'cold-outreach',
        labelName: 'Cold outreach',
        override: null,
        disposition: 'archive',
        markRead: false,
        unsubscribe: true,
        kind: 'label',
        name: null,
        whenLabel: null,
        when: null,
        source: 'user',
        hits: 1,
        lastHitAt: decided!.decidedAt,
        checks: 0,
        checkCost: 0,
        filterId: null,
        filter: {
          state: 'none',
          possible: true,
          reason: null,
          plan: { criteria: { from: '@example.com' }, gmailLabel: 'mild/cold-outreach', archive: true },
          differs: ['Mail the filter archives never reaches Mild: it is not recorded, counted or unsubscribed from.'],
          checkedAt: null,
          history: [],
        },
        createdAt: expect.any(Number),
      },
    ]);
  });

  it('counts every model call that checked a rule’s condition over 30 days, met or not, and what they cost', async () => {
    const { sift, box, me, arrives } = await settled();
    const { id } = (await me.call('POST', '/api/rules', { match: { fromDomain: ['shop.example.com'] }, label: 'receipts', when: 'it is a receipt' })).body as {
      id: string;
    };
    const receipt = box.deliver({ from: 'deals@shop.example.com', subject: 'Your receipt' });
    box.deliver({ from: 'deals@shop.example.com', subject: 'A sale' });
    await arrives();
    // A pass here has no model: this is one with a model, which checks the rule's condition for both.
    const db = await sift.db(ME);
    const usage = { model: 'test/model', inputTokens: 1, outputTokens: 1, costUsd: 0.03 };
    const model = testModel(async ({ evidence }) => ({ label: evidence.facts.messageId === receipt ? 'receipts' : 'everything_else', reason: 'r', usage }));
    await triageAccount({ db, mailbox: null, model, sources: connectGmail(fake.google) }, await firstAccount(db));
    await modelRun(db, { messageId: receipt, ruleId: id, at: Date.now() - 31 * DAY, usage: { ...usage, costUsd: 1 } });

    const rule = (await rulesOf(me)).find((r) => r.id === id);
    expect(rule).toMatchObject({ checks: 2 });
    expect(rule!.checkCost).toBeCloseTo(0.06);
  });
});

describe('applying a rule to the inbox', () => {
  it('lists what the rule decided and has not moved, and applying it stops only when stopped for that rule', async () => {
    const { box, me, arrives } = await settled();
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    const left = box.deliver({ from: NEWS, subject: 'Waiting' });
    await arrives();
    await me.call('POST', '/api/active', { active: true });
    const moved = box.deliver({ from: NEWS, subject: 'Moved' });
    await arrives();
    expect(box.labelsOf(moved)).not.toContain('INBOX');

    expect((await me.call('GET', `/api/rules/waiting?id=${id}`)).body).toEqual({
      total: 1,
      messages: [{ accountId: ME, messageId: left, subject: 'Waiting', receivedAt: expect.any(Number) }],
      applying: null,
    });
    expect((await me.call('GET', `/api/rules/inbox?id=${id}`)).body).toMatchObject({ examples: [{ accountId: ME, messageId: left }], messages: 1 });
    expect((await me.call('GET', '/api/rules/inbox?id=r-nobody')).status).toBe(404);

    expect((await me.call('POST', '/api/rules/apply', { id })).body).toEqual({ ok: true });
    expect((await me.call('GET', `/api/rules/waiting?id=${id}`)).body).toMatchObject({ applying: { listed: false, done: 0, total: 0 } });
    // Stopping going through the inbox leaves applying a rule going.
    await me.call('POST', '/api/inbox/stop', {});
    expect((await me.call('GET', `/api/rules/waiting?id=${id}`)).body).toMatchObject({ applying: { done: 0 } });
    await me.call('POST', '/api/inbox/stop', { rule: id });
    expect((await me.call('GET', `/api/rules/waiting?id=${id}`)).body).toMatchObject({ applying: null });
  });

  it('looks at what it would decide in Gmail, once a while, and applying it changes that mail in Gmail', async () => {
    const sift = await start();
    const box = fake.google.mailbox(ME);
    const before = box.deliver({ from: 'Shop <shop@example.com>', subject: 'Old receipt', at: AT - DAY }, { quietly: true });
    const me = await sift.settled(ME);
    const after = box.deliver({ from: 'Shop <shop@example.com>', subject: 'New receipt' });
    box.deliver({ from: 'ada@example.com', subject: 'Lunch?' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    const { id } = (await me.call('POST', '/api/rules', { match: { from: ['shop@example.com'] }, label: 'receipts' })).body as { id: string };

    const look = await me.call('GET', `/api/rules/inbox?id=${id}`);
    expect(look).toMatchObject({
      status: 200,
      body: {
        messages: 2,
        exact: true,
        examples: [
          { messageId: after, subject: 'New receipt' },
          { messageId: before, subject: 'Old receipt' },
        ],
      },
    });
    const searched = box.asked('users.messages.list').length;
    expect((await me.call('GET', `/api/rules/inbox?id=${id}`)).body).toEqual(look.body);
    expect(box.asked('users.messages.list')).toHaveLength(searched);

    expect((await me.call('POST', '/api/rules/apply', { id })).status).toBe(200);
    expect(await me.call('POST', '/api/rules/apply', { id })).toMatchObject({ status: 409, body: { error: 'Mild is already applying this rule.' } });
    await sift.work();
    await sift.tick();
    for (const message of [before, after]) expect(box.labelsOf(message)).toEqual(['UNREAD', box.labelId('mild/receipts')]);
  });

  it('names each label it changed in the message’s history: its own by the name it gave them, Gmail’s in words', async () => {
    const { sift, box, me, news } = await waiting();
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    await me.call('POST', '/api/rules/apply', { id });
    await sift.work();
    await sift.tick();
    expect(box.labelsOf(news)).toContain(box.labelId('mild/receipts'));

    const history = async () => (await me.call('GET', `/api/message?id=${news}`)).body['actions'] as { id: number }[];
    const [archived] = await history();
    expect(archived).toMatchObject({ type: 'archive', added: ['mild/receipts'], removed: ['Inbox'] });
    await me.call('POST', '/api/undo', { id: archived!.id });
    expect((await history()).at(-1)).toMatchObject({ type: 'undo', added: ['Inbox'], removed: ['mild/receipts'] });
  });

  it('changes nothing in Gmail once stopped', async () => {
    const { sift, box, me, news } = await waiting();
    const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
    await me.call('POST', '/api/rules/apply', { id });
    expect((await me.call('POST', '/api/inbox/stop', { rule: id })).status).toBe(200);
    await sift.work();
    await sift.tick();
    expect(box.labelsOf(news)).toEqual(['INBOX', 'UNREAD']);
    expect(box.asked('users.messages.modify')).toEqual([]);
  });
});

describe('a rule drafted by the model', () => {
  it('is filled in from the person’s words and the senders Mild has recorded, and makes nothing', async () => {
    const model = fauxModel();
    const { me } = await waiting(model);
    const blank = { facts: [], label: '', onlyOnceLabelled: false, when: '', markRead: false, unsubscribe: false, note: '', name: '' };
    model.answers(
      toolReply(FIND_TOOL, { query: 'news' }),
      toolReply(FILL_TOOL, { ...blank, conditions: [{ by: 'from', value: NEWS }], action: 'archive', markRead: true, note: 'And another.' }),
    );

    const drafted = await me.call('POST', '/api/rules/draft', { goal: '  Archive the weekly news  ' });
    expect(drafted.status).toBe(200);
    expect(drafted.body).toEqual({ match: { from: [NEWS] }, disposition: 'archive', markRead: true, note: 'And another.' });
    const [asked, found] = model.complete.mock.calls.map(([, context]) => JSON.stringify(context.messages));
    expect(asked).toContain(JSON.stringify('# The rule they want\nArchive the weekly news\n').slice(1, -1));
    expect(found).toContain(NEWS);

    for (const bad of [{}, { goal: '  ' }, { accountId: ME, goal: 'x' }]) expect((await me.call('POST', '/api/rules/draft', bad)).status).toBe(400);
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(await rulesOf(me)).toEqual([]);
  });

  it('is refused without a model', async () => {
    const { me } = await waiting();
    expect(await me.call('POST', '/api/rules/draft', { goal: 'Archive the weekly news' })).toMatchObject({
      status: 409,
      body: { error: 'Choose a model first.' },
    });
  });
});

describe('a rule Mild proposes from answers', () => {
  /** Two of `NEWS`'s mail the model read as Receipts, answered as staying in the inbox: a run Mild proposes a rule from. */
  async function proposed() {
    const ready = await waiting();
    const second = ready.box.deliver({ from: `News <${NEWS}>`, subject: 'Next week' });
    await ready.arrives();
    await ready.sift.judged(ME, second, 'receipts');
    for (const messageId of [ready.news, second])
      expect((await ready.me.call('POST', '/api/feedback', { accountId: ME, sender: NEWS, label: 'receipts', disposition: 'keep', messageId })).status).toBe(
        200,
      );
    const { proposals } = (await ready.me.call('GET', '/api/suggestions')).body as { proposals: { id: number; disposition: string }[] };
    expect(proposals).toMatchObject([{ disposition: 'keep' }]);
    return { ...ready, proposal: proposals[0]!.id };
  }

  it('is dismissed, once', async () => {
    const { me, proposal } = await proposed();
    expect((await me.call('POST', '/api/proposals', { id: proposal })).status).toBe(200);
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ proposals: [] });
    expect(await me.call('POST', '/api/proposals', { id: proposal })).toMatchObject({ status: 409, body: { error: 'That proposal is no longer open.' } });
  });

  it('is settled by the rule made from it', async () => {
    const { me, proposal } = await proposed();
    expect((await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts', disposition: 'keep', proposal })).status).toBe(200);
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ proposals: [] });
    expect(await rulesOf(me)).toMatchObject([{ match: { from: [NEWS] }, disposition: 'keep' }]);
  });

  it('is made only as the person left it in the dialog, and only once', async () => {
    const { sift, me, proposal } = await proposed();
    const open = async () => ((await me.call('GET', '/api/suggestions')).body as { proposals: { id: number }[] }).proposals.map((p) => p.id);
    // Accepting it without a rule in hand is not a way to make one.
    expect((await me.call('POST', '/api/proposals', { id: proposal, accept: true })).status).toBe(400);
    // A rule made some other way, or the dialog closed, leaves it open.
    expect((await me.call('POST', '/api/rules', { match: { from: ['other@example.com'] }, label: 'receipts' })).status).toBe(200);
    expect(await open()).toEqual([proposal]);

    // Edited in the dialog: everyone at the domain, archived as Receipts, not the sender kept.
    expect((await me.call('POST', '/api/rules', { match: { fromDomain: ['example.com'] }, label: 'receipts', proposal })).status).toBe(200);
    const rules = await rulesOf(me);
    expect(rules.filter((r) => plain(r.match.fromDomain?.[0]) === 'example.com')).toMatchObject([{ labelId: 'receipts', override: null, source: 'user' }]);
    expect(rules.filter((r) => plain(r.match.from?.[0]) === NEWS)).toEqual([]);
    expect(await open()).toEqual([]);
    expect(await raw(await sift.db(ME)).get('SELECT status FROM proposals WHERE id = ?', proposal)).toEqual({ status: 'accepted' });

    expect((await me.call('POST', '/api/rules', { match: { fromDomain: ['example.org'] }, label: 'receipts', proposal })).status).toBe(409);
    expect((await rulesOf(me)).filter((r) => plain(r.match.fromDomain?.[0]) === 'example.org')).toEqual([]);
  });

  it('cannot be dismissed by someone else', async () => {
    const { sift, me, proposal } = await proposed();
    const other = await sift.settled(OTHER);
    expect((await other.call('POST', '/api/proposals', { id: proposal })).status).toBe(409);
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ proposals: [{ id: proposal }] });
  });
});

it('shows and changes no rule of someone else’s', async () => {
  const { sift, box, me } = await waiting();
  await me.call('POST', '/api/active', { active: true });
  const { id } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'receipts' })).body as { id: string };
  await me.call('POST', '/api/rules/filter', { id, on: true });
  const other = await sift.settled(OTHER);
  await other.call('POST', '/api/active', { active: true });

  expect(await rulesOf(other)).toEqual([]);
  expect((await other.call('GET', `/api/rules/inbox?id=${id}`)).status).toBe(404);
  expect(await waitingOn(other, id)).toMatchObject({ total: 0, messages: [] });
  expect((await other.call('GET', `/api/rules/usage?id=${id}`)).body).toMatchObject({ saved: { messages: 0 } });
  expect((await other.call('POST', '/api/rules/edit', { id, match: { from: [NEWS] }, disposition: 'spam' })).status).toBe(409);
  expect((await other.call('POST', '/api/rules/apply', { id })).status).toBe(400);
  await other.call('POST', '/api/rules/filter', { id, on: false });
  await other.call('POST', '/api/rules/remove', { id });
  expect(await rulesOf(me)).toMatchObject([{ id, labelId: 'receipts', disposition: 'archive' }]);
  expect(box.filters).toHaveLength(1);
});

everyRouteAnswered('rules');
