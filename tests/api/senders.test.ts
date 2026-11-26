import { describe, expect, it } from 'vitest';
import { SHARED, UNKNOWN } from '../../src/dashboard/api/shared/senders.ts';
import type { SenderPage } from '../../src/dashboard/types.ts';
import { recordDecision } from '../../src/store/decisions.ts';
import type { Browser } from '../fixtures.ts';
import { AT, ME, OTHER, theApp } from './app.ts';
import { everyRouteAnswered } from './areas.ts';

const { fake, settled } = theApp();
const ADA = 'ada@example.com';
const BO = 'bo@example.com';
const SHOP = 'shop.example.org';

type Contact = { address: string; name: string | null; given: string | null; rules: number; recent: number };
const contactsOf = async (b: Browser, query = '') => (await b.call('GET', `/api/contacts${query}`)).body as { total: number; rows: Contact[] };
const pageOf = async (b: Browser, query: string) => (await b.call('GET', query)).body as unknown as SenderPage;
type Rule = { id: string; match: Record<string, string[]>; kind: string; labelId: string | null; disposition: string | null; source: string };
/** The rules whose first sender is `address`. */
const rulesFor = async (b: Browser, address: string) =>
  ((await b.call('GET', '/api/rules')).body['rules'] as Rule[]).filter((r) => r.match['from']?.[0] === address);

/** Signed in, with mail from Ada (twice) and Bo at example.com, and from a shop, recorded by a pass. */
async function withMail() {
  const app = await settled();
  const { box } = app;
  const mail = {
    lunch: box.deliver({ from: `Ada <${ADA}>`, subject: 'Lunch?', at: AT - 3_600_000 }),
    tea: box.deliver({ from: `Ada Lovelace <${ADA}>`, subject: 'Tea?', at: AT - 60_000 }),
    hello: box.deliver({ from: `Bo <${BO}>`, subject: 'Hello', at: AT - 7_200_000 }),
  };
  box.deliver({ from: `Shop <orders@${SHOP}>`, subject: 'Your receipt', at: AT - 10_800_000 });
  /** Mail from `from` that arrives now, brought by the next pass. */
  const arrivesFrom = async (from: string) => {
    const id = box.deliver({ from, subject: 'More' });
    await app.arrives();
    return id;
  };
  await app.arrives();
  return { ...app, mail, arrivesFrom };
}

describe('a sender’s page', () => {
  it('shows their mail newest first, under each name they used', async () => {
    const { me } = await withMail();
    const page = await me.call('GET', `/api/sender?address=${ADA.toUpperCase()}`);
    expect(page).toMatchObject({ status: 200, body: { kind: 'sender', name: 'Ada Lovelace', profile: { address: ADA, messages: 2, given: null } } });
    expect((page.body['names'] as { name: string; messages: number }[]).map((n) => [n.name, n.messages])).toEqual([
      ['Ada Lovelace', 1],
      ['Ada', 1],
    ]);
    expect(await me.call('GET', '/api/sender?address=nobody@example.com')).toMatchObject({ status: 404, body: { error: UNKNOWN } });
  });

  it('for a domain shows who writes from it, and has none for a domain anyone can get an address at', async () => {
    const { me } = await withMail();
    const page = await me.call('GET', '/api/domain?domain=example.com');
    expect(page).toMatchObject({ status: 200, body: { kind: 'domain', profile: { address: 'example.com', senders: 2 } } });
    expect((page.body['senders'] as { address: string }[]).map((s) => s.address)).toEqual([ADA, BO]);
    expect(await me.call('GET', '/api/domain?domain=gmail.com')).toMatchObject({ status: 404, body: { error: SHARED } });
  });

  it('tells their mail apart by each name they write under, with what it is, and lists the mail of one name', async () => {
    const { sift, box, me, arrives } = await settled();
    const NOTES = 'notifications@example.org';
    const { ids } = (await me.call('POST', '/api/labels/add', { labels: [{ name: 'Account alerts', description: 'Sign-ins and keys.', disposition: 'keep' }] }))
      .body as { ids: [string] };
    // An action rule's mail has no label, and is not undecided.
    await me.call('POST', '/api/rules', { match: { from: [NOTES], subjectContains: ['Weekly digest'] }, disposition: 'archive' });
    const zod = box.deliver({ from: `Dependabot <${NOTES}>`, subject: 'Bump zod', at: AT - 1000 });
    const vite = box.deliver({ from: `" dependabot  " <${NOTES}>`, subject: 'Bump vite', at: AT - 2000 });
    const key = box.deliver({ from: `Security alerts <${NOTES}>`, subject: 'New SSH key', at: AT - 3000 });
    box.deliver({ from: `Security alerts <${NOTES}>`, subject: 'Weekly digest', at: AT - 4000 });
    // One name, on some of their mail, is not several.
    box.deliver({ from: 'Example News <news@example.com>', subject: 'This week' });
    box.deliver({ from: 'news@example.com', subject: 'Last week' });
    await arrives();
    await sift.judged(ME, zod, 'receipts', 'keep');
    await sift.judged(ME, key, ids[0], 'keep');
    await recordDecision(await sift.db(ME), ME, vite, { disposition: 'review', subscription: 'preserve', stage: 'model', reason: 'Unsure.' });

    expect((await pageOf(me, `/api/sender?address=${NOTES}`)).names).toEqual([
      { name: 'Dependabot', messages: 2, lastSeenAt: AT - 1000, labels: [{ id: 'receipts', name: 'Receipts', messages: 1 }], actions: [] },
      {
        name: 'Security alerts',
        messages: 2,
        lastSeenAt: AT - 3000,
        labels: [{ id: ids[0], name: 'Account alerts', messages: 1 }],
        actions: [{ action: 'archive', messages: 1 }],
      },
    ]);
    expect((await pageOf(me, `/api/sender?address=${NOTES}&name=DEPENDABOT`)).decisions.map((d) => d.messageId).toSorted()).toEqual([zod, vite].toSorted());
    expect((await pageOf(me, '/api/sender?address=news@example.com')).names).toEqual([]);
  });

  it('shows their mail from every one of the person’s mailboxes, and a page for someone with only a rule', async () => {
    const { sift, me, box, arrives } = await settled();
    const WORK = 'me@work.example.com';
    const MEDIA = 'media@example.org';
    await me.signIn(WORK, { add: true });
    await sift.work();
    await me.call('POST', '/api/rules', { match: { from: [MEDIA] }, disposition: 'archive' });
    const home = box.deliver({ from: `Group <${MEDIA}>`, subject: 'Photos', at: AT - 2000 });
    const work = fake.google.mailbox(WORK).deliver({ from: `Group <${MEDIA}>`, subject: 'Slides', at: AT - 1000 });
    await arrives();

    const sender = await pageOf(me, `/api/sender?address=${MEDIA}`);
    expect(sender.profile).toMatchObject({ messages: 2, contact: null });
    expect(sender.decisions.map((d) => [d.accountId, d.messageId])).toEqual([
      [WORK, work],
      [ME, home],
    ]);
    expect((await pageOf(me, '/api/domain?domain=example.org')).senders).toMatchObject([{ address: MEDIA, messages: 2 }]);

    // Nothing from them and no rule about them: nothing to show but what was asked.
    expect((await me.call('GET', '/api/sender?address=nobody@example.org')).status).toBe(404);
    await me.call('POST', '/api/rules', { match: { from: ['nobody@example.org'] }, disposition: 'archive' });
    expect((await pageOf(me, '/api/sender?address=nobody@example.org')).profile).toMatchObject({ messages: 0, rules: [{ disposition: 'archive' }] });
  });

  it('narrowed to one mailbox, lists only the mail in it, and is still theirs in a mailbox with none', async () => {
    const { sift, me, box, arrives } = await settled();
    const WORK = 'me@work.example.com';
    await me.signIn(WORK, { add: true });
    await sift.work();
    const lunch = box.deliver({ from: `Ada <${ADA}>`, subject: 'Lunch?', at: AT - 2000 });
    await arrives();
    await recordDecision(await sift.db(ME), ME, lunch, { disposition: 'review', subscription: 'preserve', stage: 'model', reason: 'Unsure.' });

    const home = await pageOf(me, `/api/sender?address=${ADA}&mailbox=${ME}`);
    expect(home.decisions.map((d) => d.messageId)).toEqual([lunch]);
    for (const query of [`/api/sender?address=${ADA}&mailbox=${WORK}`, `/api/domain?domain=example.com&mailbox=${WORK}`]) {
      const work = await me.call('GET', query);
      expect(work).toMatchObject({ status: 200, body: { profile: { messages: 1 }, decisions: [] } });
    }
    expect((await me.call('GET', `/api/sender?address=bo@example.com&mailbox=${WORK}`)).status).toBe(404);
  });

  it('shows nobody else anything of them', async () => {
    const { sift } = await withMail();
    const other = await sift.settled(OTHER);
    expect((await other.call('GET', `/api/sender?address=${ADA}`)).status).toBe(404);
    expect((await other.call('GET', '/api/domain?domain=example.com')).status).toBe(404);
    expect(await contactsOf(other)).toEqual({ total: 0, rows: [] });
  });
});

describe('contacts', () => {
  it('lists everyone with mail, newest first, a page at a time, and finds them by name or address', async () => {
    const { me } = await withMail();
    const all = await contactsOf(me);
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => [r.address, r.name])).toEqual([
      [ADA, 'Ada Lovelace'],
      [BO, 'Bo'],
      ['orders@shop.example.org', 'Shop'],
    ]);
    expect((await contactsOf(me, '?limit=1&offset=1')).rows.map((r) => r.address)).toEqual([BO]);
    expect((await contactsOf(me, '?q=lovelace')).rows.map((r) => r.address)).toEqual([ADA]);
    expect((await contactsOf(me, '?q=shop')).rows.map((r) => r.address)).toEqual(['orders@shop.example.org']);
  });
});

describe('a standing', () => {
  it('is given in one press as their own rule, shown on their page and in contacts, and carried out on their next mail', async () => {
    const { box, me, arrivesFrom } = await withMail();
    await me.call('POST', '/api/active', { active: true });

    expect(await me.call('POST', '/api/standing', { address: BO, standing: 'unwanted' })).toMatchObject({
      status: 200,
      body: { id: expect.any(String), was: null },
    });
    expect((await me.call('GET', `/api/sender?address=${BO}`)).body).toMatchObject({ profile: { given: 'unwanted' } });
    expect((await contactsOf(me, '?standing=unwanted')).rows).toMatchObject([{ address: BO, given: 'unwanted', rules: 1 }]);
    expect((await me.call('GET', '/api/rules')).body).toMatchObject({ rules: [{ match: { from: [BO] }, disposition: 'archive' }] });
    expect(box.labelsOf(await arrivesFrom(`Bo <${BO}>`))).not.toContain('INBOX');

    expect(await me.call('POST', '/api/standing', { address: BO, standing: 'trusted' })).toMatchObject({ status: 200, body: { was: 'unwanted' } });
    expect((await me.call('GET', '/api/rules')).body['rules']).toHaveLength(1);
    expect(box.labelsOf(await arrivesFrom(`Bo <${BO}>`))).toContain('INBOX');
  });

  it('is given to a whole domain, and never replaces a rule of theirs that says more', async () => {
    const { me } = await withMail();
    expect((await me.call('POST', '/api/standing', { domain: 'Shop.Example.org', standing: 'unwanted' })).status).toBe(200);
    expect((await me.call('GET', '/api/domain?domain=shop.example.org')).body).toMatchObject({ profile: { given: 'unwanted' } });

    const { id } = (await me.call('POST', '/api/rules', { match: { from: [ADA] }, label: 'receipts' })).body as { id: string };
    expect(await me.call('POST', '/api/standing', { address: ADA, standing: 'blocked' })).toMatchObject({ status: 200, body: { theirs: id } });
    expect((await me.call('GET', '/api/rules')).body).toMatchObject({ rules: [{ match: { fromDomain: ['shop.example.org'] } }, { id, labelId: 'receipts' }] });
    expect((await me.call('POST', '/api/standing', { address: ADA, domain: 'example.com', standing: 'blocked' })).status).toBe(400);
  });

  it('replaces only another standing, keeping its rule and saying which it was, so Undo can give it back', async () => {
    const { me } = await withMail();
    const give = async (body: object) => await me.call('POST', '/api/standing', body);

    const fresh = await give({ address: 'Bo@example.com', standing: 'trusted' });
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual({ id: expect.any(String), was: null });
    const { id } = fresh.body as { id: string };
    expect(await rulesFor(me, BO)).toMatchObject([{ id, kind: 'label', labelId: 'everything_else', source: 'user' }]);
    expect((await give({ address: BO, standing: 'blocked' })).body).toEqual({ id, was: 'trusted' });
    expect(await rulesFor(me, BO)).toMatchObject([{ id, disposition: 'spam' }]);
    expect((await pageOf(me, `/api/sender?address=${BO}`)).profile).toMatchObject({ given: 'blocked' });
    expect((await give({ address: BO, standing: 'trusted' })).body).toEqual({ id, was: 'blocked' });

    // A rule for exactly them that says more than what happens to their mail is theirs to change in the dialog: nothing is written.
    await me.call('POST', '/api/rules/remove', { id });
    const { id: labelled } = (await me.call('POST', '/api/rules', { match: { from: [BO] }, label: 'receipts' })).body as { id: string };
    expect((await give({ address: BO, standing: 'blocked' })).body).toEqual({ theirs: labelled });
    expect(await rulesFor(me, BO)).toMatchObject([{ id: labelled, labelId: 'receipts' }]);
    const { id: reading } = (await me.call('POST', '/api/rules', { match: { fromDomain: [SHOP] }, disposition: 'archive', markRead: true })).body as {
      id: string;
    };
    expect((await give({ domain: SHOP, standing: 'unwanted' })).body).toEqual({ theirs: reading });

    expect((await give({ domain: 'example.org', standing: 'unwanted' })).body).toEqual({ id: expect.any(String), was: null });
    expect((await give({ address: BO, standing: 'known' })).status).toBe(400);
  });

  it('is given in the rule dialog too, as a rule for exactly them, which taking it back leaves when it names others', async () => {
    const { sift, me, mail } = await withMail();
    for (const id of Object.values(mail)) await sift.judged(ME, id, 'receipts');
    const page = await pageOf(me, `/api/sender?address=${ADA}`);
    expect(page).toMatchObject({
      kind: 'sender',
      name: 'Ada Lovelace',
      profile: { address: ADA, messages: 2, contact: null, given: null, domain: { name: 'example.com', contact: null } },
    });
    expect(page.decisions.map((d) => [d.fromAddress, d.messageId])).toEqual([
      [ADA, mail.tea],
      [ADA, mail.lunch],
    ]);

    await me.call('POST', '/api/rules', { match: { from: [ADA] }, label: 'receipts' });
    // Trust, as the dialog makes it: a rule for exactly them that only leaves their mail in the inbox. It replaces the rule for exactly them,
    // and says so, so the page offers no Undo: removing it would not bring the old rule back.
    expect((await me.call('POST', '/api/rules', { match: { from: [ADA] }, disposition: 'keep' })).body).toMatchObject({ replaced: true });
    expect(await rulesFor(me, ADA)).toMatchObject([{ kind: 'label', labelId: 'everything_else', source: 'user' }]);
    expect((await pageOf(me, `/api/sender?address=${ADA}`)).profile).toMatchObject({ given: 'trusted' });

    expect((await me.call('POST', '/api/rules', { match: { fromDomain: [SHOP] }, disposition: 'spam' })).body).toMatchObject({ replaced: false });
    expect(await pageOf(me, `/api/domain?domain=${SHOP}`)).toMatchObject({
      kind: 'domain',
      profile: { given: 'blocked' },
      senders: [{ address: `orders@${SHOP}`, contact: 'new' }],
    });

    expect((await me.call('POST', '/api/standing/clear', { address: ADA })).status).toBe(200);
    expect(await rulesFor(me, ADA)).toEqual([]);

    await me.call('POST', '/api/rules', { match: { from: [ADA, BO] }, disposition: 'archive' });
    expect((await pageOf(me, `/api/sender?address=${ADA}`)).profile).toMatchObject({ given: null, rules: [{ match: { from: [ADA, BO] } }] });
    expect((await me.call('POST', '/api/standing/clear', { address: ADA })).status).toBe(200);
    expect(await rulesFor(me, ADA)).toHaveLength(1);

    expect((await me.call('POST', '/api/standing/clear', { address: ADA, domain: 'example.com' })).status).toBe(400);
    expect((await me.call('POST', '/api/standing/clear', { address: 'not an address' })).status).toBe(400);
  });

  it('is cleared, and with it the rule and its Gmail filter', async () => {
    const { box, me, arrivesFrom } = await withMail();
    await me.call('POST', '/api/active', { active: true });
    const { id } = (await me.call('POST', '/api/standing', { address: BO, standing: 'unwanted' })).body as { id: string };
    await me.call('POST', '/api/rules/filter', { id, on: true });
    expect(box.filters).toHaveLength(1);

    expect((await me.call('POST', '/api/standing/clear', { address: BO })).status).toBe(200);
    expect(box.filters).toEqual([]);
    expect((await me.call('GET', '/api/rules')).body).toEqual({ rules: [] });
    expect((await me.call('GET', `/api/sender?address=${BO}`)).body).toMatchObject({ profile: { given: null } });
    expect(box.labelsOf(await arrivesFrom(`Bo <${BO}>`))).toContain('INBOX');
    expect((await me.call('POST', '/api/standing/clear', { domain: 'example.com' })).status).toBe(200);
  });

  it('is each person’s own to give and clear', async () => {
    const { sift, me } = await withMail();
    await me.call('POST', '/api/standing', { address: BO, standing: 'unwanted' });
    const other = await sift.settled(OTHER);
    expect((await other.call('POST', '/api/standing/clear', { address: BO })).status).toBe(200);
    expect((await me.call('GET', `/api/sender?address=${BO}`)).body).toMatchObject({ profile: { given: 'unwanted' } });
    expect((await other.call('POST', '/api/standing', { address: BO, standing: 'trusted' })).body).toMatchObject({ was: null });
    expect((await me.call('GET', `/api/sender?address=${BO}`)).body).toMatchObject({ profile: { given: 'unwanted' } });
  });
});

everyRouteAnswered('senders');
