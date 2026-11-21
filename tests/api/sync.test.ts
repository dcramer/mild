import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncPage } from '../../src/dashboard/types.ts';
import { fakeGoogle, startSift } from '../fixtures.ts';
import { DAY } from '../helpers.ts';
import { LEAVE_IN_INBOX } from '../../src/triage/types.ts';
import { everyRouteAnswered } from './areas.ts';

const fake = fakeGoogle();
const ME = 'me@example.org';
const AT = Date.UTC(2026, 10, 18, 12);

beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'], now: AT, shouldAdvanceTime: true }));
afterEach(() => void vi.useRealTimers());

type Me = Awaited<ReturnType<Awaited<ReturnType<typeof startSift>>['settled']>>;

async function withInbox() {
  const sift = await startSift(fake.google);
  const box = fake.google.mailbox(ME);
  const me = await sift.settled(ME);
  expect((await me.call('POST', '/api/mail/on', { on: true })).status).toBe(200);
  await sift.work();
  const arrives = async () => {
    expect((await me.call('POST', '/api/check', {})).status).toBe(200);
    await sift.work();
  };
  return { sift, box, me, arrives };
}

/** Every page from `since` on, as the page reads them: what each said, and where it ended. */
async function pull(me: Me, since?: string) {
  const pages: SyncPage[] = [];
  let cursor = since;
  do {
    const reply = await me.call('GET', `/api/sync${cursor ? `?since=${cursor}` : ''}`);
    expect(reply.status).toBe(200);
    pages.push(reply.body as unknown as SyncPage);
    cursor = pages.at(-1)!.cursor;
  } while (pages.at(-1)!.more);
  return { pages, cursor: cursor, conversations: pages.flatMap((p) => p.conversations) };
}

describe('the copy the page keeps', () => {
  it('starts with every conversation in the inbox, newest first, each whole, with what Mild thinks of its newest', async () => {
    const { sift, box, me, arrives } = await withInbox();
    const lunch = box.deliver({ from: 'Ada <ada@example.com>', subject: 'Lunch?', text: 'Lunch on Friday?', at: AT - DAY });
    const reply = box.deliver({ from: 'Ada <ada@example.com>', subject: 'Re: Lunch?', threadId: lunch, text: 'Or Saturday.', at: AT - 60_000 });
    const tea = box.deliver({ from: 'bo@example.com', subject: 'Tea?', at: AT - 2 * DAY });
    box.deliver({ from: 'cy@example.com', subject: 'Archived', at: AT - 3 * DAY, labelIds: [] });
    await arrives();
    await sift.judged(ME, reply, 'receipts');

    const { pages, conversations } = await pull(me);
    expect(pages[0]).toMatchObject({ reset: true, mailboxes: [ME] });
    expect(conversations.map((c) => c.threadId)).toEqual([lunch, tea]);
    expect(conversations[0]!.conversation).toMatchObject({
      accountId: ME,
      threadId: lunch,
      messages: [
        { messageId: lunch, fromAddress: 'ada@example.com', fromName: 'Ada', subject: 'Lunch?', preview: 'Lunch on Friday?', labelIds: ['INBOX', 'UNREAD'] },
        { messageId: reply, subject: 'Re: Lunch?', preview: 'Or Saturday.' },
      ],
      thinks: { disposition: 'archive', labelId: 'receipts', stage: 'model', confidence: 0.9 },
    });
    expect(conversations[1]!.conversation!.thinks).toBeNull();
  });

  it('then sends only what changed, as it is now, and a conversation gone from the inbox as gone', async () => {
    const { box, me, arrives } = await withInbox();
    const a = box.deliver({ from: 'ada@example.com', subject: 'One', at: AT - DAY });
    const b = box.deliver({ from: 'bo@example.com', subject: 'Two', at: AT - 2 * DAY });
    await arrives();
    const start = await pull(me);
    expect((await pull(me, start.cursor)).conversations).toEqual([]);

    const c = box.deliver({ from: 'cy@example.com', subject: 'Three' });
    await arrives();
    const arrived = await pull(me, start.cursor);
    expect(arrived.pages[0]!.reset).toBe(false);
    expect(arrived.conversations.map((x) => [x.threadId, x.conversation?.messages[0]?.subject])).toEqual([[c, 'Three']]);

    const archived = await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [a], change: 'archive' });
    expect(archived.status).toBe(200);
    const seq = Number(archived.headers.get('x-sift-seq'));
    const after = await pull(me, arrived.cursor);
    expect(after.conversations).toEqual([{ accountId: ME, threadId: a, conversation: null }]);
    // The write's number is how far the page must read to hold its change.
    expect(arrived.pages.at(-1)!.seq).toBeLessThan(seq);
    expect(after.pages.at(-1)!.seq).toBe(seq);
    expect((await pull(me, after.cursor)).conversations).toEqual([]);

    // Read in Gmail: the conversation comes again, read.
    box.change(b, { remove: ['UNREAD'] });
    await arrives();
    expect((await pull(me, after.cursor)).conversations.map((x) => x.conversation?.messages[0]?.labelIds)).toEqual([['INBOX']]);
  });

  it('says what the person answered about a conversation’s newest message', async () => {
    const { sift, box, me, arrives } = await withInbox();
    const a = box.deliver({ from: 'ada@example.com', subject: 'One' });
    await arrives();
    const { cursor } = await pull(me);
    const decisionId = await sift.judged(ME, a, 'receipts');
    const judged = await pull(me, cursor);
    expect(judged.conversations).toMatchObject([{ threadId: a, conversation: { thinks: { decisionId, labelId: 'receipts' } } }]);
    const answer = { accountId: ME, sender: 'ada@example.com', label: LEAVE_IN_INBOX, messageId: a, decisionId };
    expect((await me.call('POST', '/api/feedback', answer)).status).toBe(200);
    expect((await pull(me, judged.cursor)).conversations).toMatchObject([
      { threadId: a, conversation: { thinks: { labelId: LEAVE_IN_INBOX, disposition: 'keep' } } },
    ]);
  });

  it('starts again, empty, once Inbox is off, and whole once it is on again', async () => {
    const { sift, box, me, arrives } = await withInbox();
    box.deliver({ from: 'ada@example.com', subject: 'One' });
    await arrives();
    const { cursor } = await pull(me);

    expect((await me.call('POST', '/api/mail/on', { on: false })).status).toBe(200);
    const off = await pull(me, cursor);
    expect(off.pages[0]).toMatchObject({ reset: true, conversations: [] });

    expect((await me.call('POST', '/api/mail/on', { on: true })).status).toBe(200);
    await sift.work();
    const on = await pull(me, off.cursor);
    expect(on.pages[0]!.reset).toBe(true);
    expect(on.conversations).toHaveLength(1);
  });

  it('starts again from a cursor it cannot read or one from before the copy was', async () => {
    const { me } = await withInbox();
    for (const since of ['nonsense', Buffer.from(JSON.stringify({ shape: 0, seq: 0 })).toString('base64url')])
      expect((await me.call('GET', `/api/sync?since=${since}`)).body).toMatchObject({ reset: true });
    const ahead = Buffer.from(JSON.stringify({ shape: 1, seq: 10_000 })).toString('base64url');
    expect((await me.call('GET', `/api/sync?since=${ahead}`)).body).toMatchObject({ reset: true });
  });
});

describe('the key of the copy in this browser', () => {
  it('is made once for the browser, given back while it is signed in, and gone at sign-out with what the browser kept', async () => {
    const sift = await startSift(fake.google);
    const me = await sift.settled(ME);
    expect((await me.call('GET', '/api/device')).body).toEqual({ key: null });
    const made = await me.call('POST', '/api/device', {});
    const { key } = made.body as { key: string };
    expect(key).toMatch(/^[\w-]{43}$/);
    expect((await me.call('GET', '/api/device')).body).toEqual({ key });

    const out = await me.call('POST', '/api/signout', {});
    expect(out.headers.get('clear-site-data')).toBe('"storage"');
    await me.signIn(ME);
    expect((await me.call('GET', '/api/device')).body).toEqual({ key: null });
  });

  it('is made for nobody signed out', async () => {
    const sift = await startSift(fake.google);
    const stranger = sift.browser();
    expect((await stranger.call('POST', '/api/device', {})).status).toBe(401);
    expect((await stranger.call('GET', '/api/device')).status).toBe(401);
  });
});

everyRouteAnswered('sync');
