import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { PROPOSAL_TOOL } from '../../src/prompts/proposal.ts';
import { MAX_LABELS, listLabels } from '../../src/store/labels.ts';
import { listRules } from '../../src/store/rules.ts';
import { LEAVE_IN_INBOX } from '../../src/triage/types.ts';
import { type Browser, fauxModel, raw, withReason } from '../fixtures.ts';
import { ME, OTHER, theApp } from './app.ts';
import { everyRouteAnswered } from './areas.ts';
import { toolReply, PITCHES } from '../helpers.ts';

const { fake, start, settled } = theApp();

type Label = {
  id: string;
  name: string;
  description: string;
  disposition: string;
  markRead: boolean;
  unsubscribe: boolean;
  gmailLabel: string | null;
  rules: number;
};
const labelsOf = async (b: Browser) => (await b.call('GET', '/api/manage')).body['labels'] as Label[];
/** The person's labels as stored, where `block` and `digest` are flags on the action beneath them. */
const stored = async (sift: Awaited<ReturnType<typeof start>>) => await listLabels(await sift.db(ME));
const BUILDS = {
  why: 'builds only when one fails',
  name: 'Build results',
  description: 'Results of builds.',
  action: 'digest',
  markRead: false,
  unsubscribe: false,
};

describe('setting up labels', () => {
  it('asks the model for labels from what the person wants, keeps its answer, and reads no Gmail until some are made', async () => {
    const model = fauxModel();
    const sift = await start({ model: model.chosen });
    const box = fake.google.mailbox(ME);
    const me = await sift.signedIn(ME);
    await sift.work();
    model.answers(toolReply(PROPOSAL_TOOL, { labels: [PITCHES, BUILDS], note: '' }));

    const proposed = await me.call('POST', '/api/labels/propose', { goal: 'Fewer sales pitches, and builds only when they fail' });
    expect(proposed).toMatchObject({
      status: 200,
      body: {
        drafts: [
          { name: 'Cold outreach', disposition: 'archive', unsubscribe: true },
          { name: 'Build results', disposition: 'digest' },
        ],
      },
    });
    expect((await me.call('GET', '/api/labels/proposal')).body).toMatchObject({ proposal: proposed.body });

    box.deliver({ from: 'ada@example.com' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    expect(box.asked('users.history.list')).toEqual([]);

    const accepted = await me.call('POST', '/api/labels/accept', {
      labels: [
        { name: 'Cold outreach', description: 'Pitches from strangers.', disposition: 'archive', unsubscribe: true },
        { name: 'Build results', description: 'Results of builds.', disposition: 'digest' },
      ],
      timeZone: 'Europe/Paris',
    });
    expect(accepted).toMatchObject({ status: 200, body: { ids: [expect.any(String), expect.any(String)] } });
    expect(await labelsOf(me)).toMatchObject([
      { name: 'Cold outreach', disposition: 'archive' },
      { name: 'Build results', disposition: 'digest' },
      { name: 'Leave in inbox' },
    ]);
    expect((await me.call('GET', '/api/manage')).body).toMatchObject({ digest: { timeZone: 'Europe/Paris' } });
    await sift.work();
    expect(box.asked('users.history.list')).not.toEqual([]);

    expect(await me.call('POST', '/api/labels/accept', { labels: [{ name: 'More', description: 'More.', disposition: 'keep' }] })).toMatchObject({
      status: 409,
      body: { error: 'You have labels already. Change them on the Labels screen.' },
    });
  });

  it('says so when the model suggests nothing usable, and without a model', async () => {
    const model = fauxModel();
    const sift = await start({ model: model.chosen });
    const me = await sift.signedIn(ME);
    model.answers(fauxAssistantMessage([fauxText('Try a Marketing label.')]));
    expect(await me.call('POST', '/api/labels/propose', { goal: 'Fewer pitches' })).toMatchObject({
      status: 409,
      body: { error: 'The model could not suggest labels (the model did not suggest any usable labels). Try again.' },
    });

    const without = await (await start()).signedIn(OTHER);
    expect(await without.call('POST', '/api/labels/propose', { goal: 'Fewer pitches' })).toMatchObject({
      status: 409,
      body: { error: 'Choose a model first.' },
    });
  });

  it('asks the model once, about the person’s mailbox, for a goal it can use, and makes the labels they keep all or none', async () => {
    const model = fauxModel();
    const sift = await start({ model: model.chosen });
    const me = await sift.signedIn(ME);
    await sift.work();
    expect((await me.call('GET', '/api/labels/proposal')).body).toEqual({ proposal: null });

    model.answers(toolReply(PROPOSAL_TOOL, { labels: [PITCHES], note: '' }));
    expect((await me.call('POST', '/api/labels/propose', { goal: '  Fewer sales pitches  ' })).body).toMatchObject({
      goal: 'Fewer sales pitches',
      drafts: [{ name: 'Cold outreach', disposition: 'archive', unsubscribe: true }],
    });
    for (const bad of [{}, { goal: '   ' }, { goal: 'x', accountId: ME }]) expect((await me.call('POST', '/api/labels/propose', bad)).status).toBe(400);
    expect(model.complete).toHaveBeenCalledTimes(1);
    expect(await raw(await sift.db(ME)).all('SELECT account_id FROM label_proposals')).toEqual([{ account_id: ME }]);

    const pitches = { name: 'Pitches', description: 'From strangers.', disposition: 'archive', unsubscribe: true };
    expect((await me.call('POST', '/api/labels/accept', { labels: [pitches, { ...pitches }] })).status).toBe(409);
    expect(await stored(sift)).toHaveLength(1);
    const accepted = await me.call('POST', '/api/labels/accept', { labels: [pitches, { name: 'Lies', description: 'Scams.', disposition: 'block' }] });
    expect(accepted.body).toEqual({ ids: ['pitches', 'lies'] });
    expect(await stored(sift)).toEqual([
      { id: 'pitches', name: 'Pitches', description: 'From strangers.', disposition: 'archive', gmailLabel: 'mild/pitches', unsubscribe: true },
      { id: 'lies', name: 'Lies', description: 'Scams.', disposition: 'spam', gmailLabel: 'mild/lies', block: true },
      expect.objectContaining({ id: LEAVE_IN_INBOX }),
    ]);
    expect((await me.call('POST', '/api/labels/accept', { labels: [] })).status).toBe(400);
  });

  it('shows nobody else the proposal', async () => {
    const model = fauxModel();
    const sift = await start({ model: model.chosen });
    const me = await sift.signedIn(ME);
    model.answers(toolReply(PROPOSAL_TOOL, { labels: [PITCHES], note: '' }));
    await me.call('POST', '/api/labels/propose', { goal: 'Fewer pitches' });
    const other = await sift.signedIn(OTHER);
    expect((await other.call('GET', '/api/labels/proposal')).body).toEqual({ proposal: null });
  });
});

describe('a person’s labels', () => {
  it('are added, all or none, and a digest’s hour is kept in the person’s own zone', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    const added = await me.call('POST', '/api/labels/add', {
      labels: [{ name: 'Updates', description: 'Product updates.', disposition: 'digest' }],
      timeZone: 'America/New_York',
    });
    expect(added).toMatchObject({ status: 200, body: { ids: ['updates'] } });
    expect((await labelsOf(me)).map((l) => l.name)).toEqual(['Receipts', 'Updates', 'Leave in inbox']);
    expect((await me.call('GET', '/api/manage')).body).toMatchObject({ digest: { timeZone: 'America/New_York' } });

    const twice = await me.call('POST', '/api/labels/add', {
      labels: [
        { name: 'Travel', description: 'Trips.', disposition: 'keep' },
        { name: 'Updates', description: 'Again.', disposition: 'archive' },
      ],
    });
    expect(twice.status).toBe(409);
    expect((await labelsOf(me)).map((l) => l.name)).toEqual(['Receipts', 'Updates', 'Leave in inbox']);
  });

  it('change what they do, and what is waiting with them is decided again', async () => {
    const sift = await start();
    const box = fake.google.mailbox(ME);
    const me = await sift.settled(ME);
    const id = box.deliver({ from: 'shop@example.com', subject: 'Receipt' });
    await me.call('POST', '/api/check', {});
    await sift.work();
    await sift.judged(ME, id, 'receipts');

    const changed = await me.call('POST', '/api/labels', { id: 'receipts', disposition: 'spam', markRead: false });
    expect(changed).toMatchObject({ status: 200, body: { ok: true, redecided: 1 } });
    expect(await labelsOf(me)).toMatchObject([{ id: 'receipts', disposition: 'spam' }, { id: 'everything_else' }]);
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({ items: [{ messageId: id, labelId: 'receipts', disposition: 'spam' }] });
    expect(await me.call('POST', '/api/labels', { id: 'nothing', name: 'Nothing' })).toMatchObject({
      status: 409,
      body: { error: 'There is no label "nothing".' },
    });
  });

  it('are removed with their rules and those rules’ Gmail filters, though never the last one or Leave in inbox', async () => {
    const sift = await start();
    const box = fake.google.mailbox(ME);
    const me = await sift.settled(ME);
    await me.call('POST', '/api/labels/add', { labels: [{ name: 'Updates', description: 'Product updates.', disposition: 'archive' }] });
    await me.call('POST', '/api/active', { active: true });
    const { id: rule } = (await me.call('POST', '/api/rules', { match: { from: ['news@example.com'] }, label: 'updates' })).body as { id: string };
    await me.call('POST', '/api/rules/filter', { id: rule, on: true });
    expect(box.filters).toHaveLength(1);

    expect(await me.call('POST', '/api/labels/remove', { id: 'updates' })).toMatchObject({ status: 200, body: { ok: true } });
    expect((await labelsOf(me)).map((l) => l.id)).toEqual(['receipts', 'everything_else']);
    expect((await me.call('GET', '/api/rules')).body).toEqual({ rules: [] });
    expect(box.filters).toEqual([]);

    expect((await me.call('POST', '/api/labels/remove', { id: 'receipts' })).status).toBe(409);
    expect((await me.call('POST', '/api/labels/remove', { id: 'everything_else' })).status).toBe(409);
    expect((await labelsOf(me)).map((l) => l.id)).toEqual(['receipts', 'everything_else']);
  });

  it('are each person’s own', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    await me.call('POST', '/api/labels/add', { labels: [{ name: 'Updates', description: 'Product updates.', disposition: 'archive' }] });
    const other = await sift.settled(OTHER);
    expect((await labelsOf(other)).map((l) => l.id)).toEqual(['receipts', 'everything_else']);
    expect((await other.call('POST', '/api/labels/remove', { id: 'updates' })).status).toBe(409);
    expect((await me.call('POST', '/api/labels', { id: 'updates', disposition: 'keep' })).status).toBe(200);
    expect((await other.call('POST', '/api/labels', { id: 'updates', disposition: 'spam' })).status).toBe(409);
    expect(await labelsOf(me)).toMatchObject([{ id: 'receipts' }, { id: 'updates', disposition: 'keep' }, { id: 'everything_else' }]);
  });
});

describe('changing a label', () => {
  it('renames it in place under its Gmail label, and refuses a name taken, reserved or with nothing to name it by, all or none', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    expect((await me.call('POST', '/api/labels/add', { labels: [{ name: 'Travel', description: 'Bookings.', disposition: 'keep' }] })).body).toEqual({
      ids: ['travel'],
    });
    expect((await me.call('POST', '/api/labels', { id: 'travel', disposition: 'archive', name: 'Trips' })).status).toBe(200);
    expect((await labelsOf(me)).find((l) => l.id === 'travel')).toMatchObject({ name: 'Trips', disposition: 'archive', gmailLabel: 'mild/travel' });
    expect((await me.call('POST', '/api/labels', { id: 'travel', disposition: 'delete' })).status).toBe(400);

    const mine = await me.call('POST', '/api/labels/add', {
      labels: [{ name: 'Investor updates', description: 'Updates from companies I invested in.', disposition: 'keep' }],
    });
    expect(mine.body).toEqual({ ids: ['investor-updates'] });
    expect((await stored(sift)).at(-2)).toEqual({
      id: 'investor-updates',
      name: 'Investor updates',
      description: 'Updates from companies I invested in.',
      disposition: 'keep',
      gmailLabel: 'mild/investor-updates',
    });
    for (const taken of ['investor updates', 'Receipts', 'Trips', 'Review', 'Did', '!!!'])
      expect((await me.call('POST', '/api/labels/add', { labels: [{ name: taken, description: '', disposition: 'keep' }] })).status, taken).toBe(409);
    const both = [
      { name: 'Shopping', description: '', disposition: 'keep' },
      { name: 'Trips', description: '', disposition: 'keep' },
    ];
    expect((await me.call('POST', '/api/labels/add', { labels: both })).status).toBe(409);
    expect((await labelsOf(me)).map((l) => l.id)).toEqual(['receipts', 'travel', 'investor-updates', LEAVE_IN_INBOX]);
  });

  it('adds up to the most a person may have, not counting Leave in inbox', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    const own = async () => (await labelsOf(me)).filter((l) => l.id !== LEAVE_IN_INBOX).length;
    for (let n = await own(); n < MAX_LABELS; n++)
      expect((await me.call('POST', '/api/labels/add', { labels: [{ name: `Extra ${n}`, description: '', disposition: 'keep' }] })).status).toBe(200);
    expect((await me.call('POST', '/api/labels/add', { labels: [{ name: 'One too many', description: '', disposition: 'keep' }] })).status).toBe(409);
    expect(await own()).toBe(MAX_LABELS);
  });

  it('changes nothing of Leave in inbox', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    expect((await me.call('POST', '/api/labels', { id: LEAVE_IN_INBOX, description: 'Bills I still owe' })).status).toBe(409);
    expect((await labelsOf(me)).find((l) => l.id === LEAVE_IN_INBOX)?.description).toBe('');
  });

  it('sets what it does, blocking and marking read included, and what a rule adds to it', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    await me.call('POST', '/api/labels/add', {
      labels: [
        { name: 'Phishing', description: 'Impersonation.', disposition: 'spam' },
        { name: 'Personal', description: 'From people.', disposition: 'keep' },
      ],
    });
    const does = async (id: string) => (await stored(sift)).find((l) => l.id === id);

    expect((await me.call('POST', '/api/labels', { id: 'receipts', disposition: 'block' })).status).toBe(200);
    expect(await does('receipts')).toMatchObject({ disposition: 'spam', block: true });
    expect((await me.call('POST', '/api/labels', { id: 'receipts', disposition: 'archive', markRead: true })).status).toBe(200);
    expect(await does('receipts')).toMatchObject({ disposition: 'archive', markRead: true });
    expect(await does('receipts')).not.toHaveProperty('block');
    const shown = await labelsOf(me);
    expect(shown.find((l) => l.id === 'receipts')).toMatchObject({ disposition: 'archive', markRead: true });
    expect(shown.find((l) => l.id === 'phishing')).toMatchObject({ disposition: 'spam', markRead: false });

    expect((await me.call('POST', '/api/labels', { id: 'personal', unsubscribe: true })).status).toBe(200);
    expect(await does('personal')).toMatchObject({ disposition: 'keep', unsubscribe: true });
    expect((await me.call('POST', '/api/labels', { id: 'personal', unsubscribe: 'yes' })).status).toBe(400);
    const extra = await me.call('POST', '/api/rules', { match: { from: ['x@example.com'] }, label: 'personal', unsubscribe: true, markRead: true });
    expect((await listRules(await sift.db(ME))).find((r) => r.id === extra.body['id'])).toMatchObject({ subscription: 'unsubscribe', markRead: true });

    // Leave it for me is not something a label does.
    expect((await me.call('POST', '/api/labels', { id: 'receipts', disposition: 'review' })).status).toBe(400);
    expect((await me.call('POST', '/api/labels', { id: 'receipts', markRead: 'yes' })).status).toBe(400);
    expect((await me.call('POST', '/api/labels/add', { labels: [{ name: 'Scams', description: '', disposition: 'block' }] })).body).toEqual({
      ids: ['scams'],
    });
    expect((await stored(sift)).at(-2)).toMatchObject({ id: 'scams', disposition: 'spam', block: true });
  });

  it('puts its mail in a daily digest, at the hour of the first time zone a label write tells it', async () => {
    const sift = await start();
    const me = await sift.settled(ME);
    const manage = async () => (await me.call('GET', '/api/manage')).body;
    const does = async () => (await stored(sift)).find((l) => l.id === 'receipts');

    expect((await me.call('POST', '/api/labels', { id: 'receipts', disposition: 'digest', timeZone: 'America/Denver' })).status).toBe(200);
    expect(await does()).toMatchObject({ disposition: 'archive', digest: true });
    expect(await manage()).toMatchObject({ digest: { hour: 7, timeZone: 'America/Denver' } });
    expect((await labelsOf(me)).find((l) => l.id === 'receipts')).toMatchObject({ disposition: 'digest' });

    // Another device's zone does not move the hour; Settings, where the hour is set, does.
    await me.call('POST', '/api/labels/add', { labels: [{ name: 'Builds', description: '', disposition: 'digest' }], timeZone: 'Asia/Tokyo' });
    expect(await manage()).toMatchObject({ digest: { hour: 7, timeZone: 'America/Denver' } });
    expect((await me.call('POST', '/api/digest', { hour: 6, timeZone: 'Asia/Tokyo' })).status).toBe(200);
    for (const body of [
      { hour: 24, timeZone: 'Asia/Tokyo' },
      { hour: 6.5, timeZone: 'Asia/Tokyo' },
      { hour: 6, timeZone: 'Somewhere/Else' },
    ])
      expect((await me.call('POST', '/api/digest', body)).status, JSON.stringify(body)).toBe(400);
    expect(await manage()).toMatchObject({ digest: { hour: 6, timeZone: 'Asia/Tokyo' } });

    expect((await me.call('POST', '/api/labels', { id: 'receipts', disposition: 'digest', timeZone: 'Not a zone' })).status).toBe(400);
    expect((await me.call('POST', '/api/labels', { id: 'receipts', disposition: 'archive' })).status).toBe(200);
    expect(await does()).not.toHaveProperty('digest');
  });
});

describe('removing a label', () => {
  const SALES = 'sales@example.com';
  const NEWS = 'news@example.com';

  it('takes its rules and examples with it, leaves mail waiting with it for the reader, and earlier mail keeps its name', async () => {
    const { sift, box, me, arrives } = await settled();
    await me.call('POST', '/api/labels/add', {
      labels: [
        { name: 'Marketing', description: 'A sale.', disposition: 'archive' },
        { name: 'Newsletters', description: 'Newsletters.', disposition: 'archive' },
      ],
    });
    const waiting = box.deliver({ from: SALES, subject: 'A sale' });
    const pitch = box.deliver({ from: SALES, subject: 'Another sale' });
    const news = box.deliver({ from: NEWS, subject: 'This week' });
    await arrives();
    await me.call('POST', '/api/active', { active: true });
    const spam = await me.call('POST', '/api/rules', { match: { from: [SALES] }, whenLabel: 'marketing', disposition: 'spam' });
    const { id: kept } = (await me.call('POST', '/api/rules', { match: { from: [NEWS] }, label: 'newsletters' })).body as { id: string };
    expect(spam.status).toBe(200);
    expect((await me.call('POST', '/api/rules/filter', { id: kept, on: true })).status).toBe(200);
    const filters = [...box.filters];
    expect(filters).toHaveLength(1);
    await sift.judged(ME, waiting, 'marketing');
    for (const [messageId, sender, label] of [
      [pitch, SALES, 'marketing'],
      [news, NEWS, 'newsletters'],
    ] as const)
      expect((await me.call('POST', '/api/feedback', { accountId: ME, sender, label, messageId, carryOut: false })).status).toBe(200);

    expect(await me.call('POST', '/api/labels/remove', { id: 'marketing' })).toMatchObject({ status: 200, body: { ok: true, redecided: 1 } });
    expect(box.filters).toEqual(filters);
    expect((await labelsOf(me)).map((l) => l.id)).toEqual(['receipts', 'newsletters', LEAVE_IN_INBOX]);
    expect(((await me.call('GET', '/api/rules')).body['rules'] as { id: string }[]).map((r) => r.id)).toEqual([kept]);
    expect((await me.call('GET', '/api/examples')).body['examples']).toMatchObject([{ messageId: news, labelId: 'newsletters' }]);
    expect((await me.call('GET', '/api/suggestions')).body).toMatchObject({
      items: [{ messageId: waiting, disposition: 'review', labelId: null, stage: 'fallback' }],
    });
    const db = raw(await sift.db(ME));
    expect(withReason(await db.get('SELECT reason FROM decisions WHERE message_id = ? ORDER BY id DESC LIMIT 1', waiting))).toEqual({
      reason: 'the label it was given has been removed',
    });
    // What Mild said of it before still names the label.
    expect(await db.get('SELECT label_id FROM decisions WHERE message_id = ? ORDER BY id LIMIT 1', waiting)).toEqual({ label_id: 'marketing' });
    expect(await db.get(`SELECT name FROM labels WHERE id = 'marketing'`)).toEqual({ name: 'Marketing' });

    expect((await me.call('POST', '/api/labels/remove', { id: 'marketing' })).status).toBe(409);
    expect((await me.call('POST', '/api/labels/remove', { id: LEAVE_IN_INBOX })).status).toBe(409);
    expect((await me.call('POST', '/api/labels', { id: 'marketing', name: 'Sales' })).status).toBe(409);

    expect((await me.call('POST', '/api/labels/remove', { id: 'receipts' })).status).toBe(200);
    const last = await me.call('POST', '/api/labels/remove', { id: 'newsletters' });
    expect(last.status).toBe(409);
    expect(last.body['error']).toContain('Newsletters is the last of your labels');

    // The name again brings it back, as the label it is now.
    const again = await me.call('POST', '/api/labels/add', { labels: [{ name: 'Marketing', description: 'Sales pitches.', disposition: 'keep' }] });
    expect(again.body).toEqual({ ids: ['marketing'] });
    expect((await labelsOf(me)).find((l) => l.id === 'marketing')).toMatchObject({ description: 'Sales pitches.', disposition: 'keep' });
  });
});

everyRouteAnswered('labels');
