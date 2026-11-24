import { describe, expect, it, vi } from 'vitest';
import { DRAFT_QUIET_MS } from '../../src/actions/drafts.ts';
import { SETTLE_MS } from '../../src/actions/send.ts';
import { ASK_TOOL } from '../../src/prompts/mail-ask.ts';
import { FIND_TOOL } from '../../src/prompts/rule-draft.ts';
import { type Browser, fauxModel } from '../fixtures.ts';
import { DAY, toolReply } from '../helpers.ts';
import { AT, ME, OTHER, theApp } from './app.ts';
import { everyRouteAnswered } from './areas.ts';

const { fake, start, withInbox } = theApp();

type Thread = { threadId: string; subject: string; messageIds: string[]; unread: boolean; place: string; preview: string | null };
const threadsOf = (reply: { body: Record<string, unknown> }) => reply.body['threads'] as Thread[];

/** The files of a message as sent: each one's name, type and bytes. */
function filesOf(raw: string): { name: string; type: string; data: Buffer }[] {
  const boundary = /boundary="([^"]+)"/.exec(raw)?.[1];
  if (!boundary) return [];
  return raw
    .split(`--${boundary}`)
    .filter((part) => /Content-Disposition: attachment/.test(part))
    .map((part) => {
      const [head, body] = [part.slice(0, part.indexOf('\r\n\r\n')), part.slice(part.indexOf('\r\n\r\n') + 4)];
      return {
        name: decodeURIComponent(/filename\*=UTF-8''([^\s;]+)/.exec(head)![1]!),
        type: /Content-Type: ([^;\r\n]+)/.exec(head)![1]!,
        data: Buffer.from(body.replaceAll(/\s/g, ''), 'base64'),
      };
    });
}

describe('Inbox, turned on and off', () => {
  it('says how much each window would copy from Gmail’s counts, and asks Gmail again only after a while', async () => {
    const sift = await start();
    const box = fake.google.mailbox(ME);
    box.deliver({ from: 'ada@example.com', at: AT - 2 * DAY }, { quietly: true });
    box.deliver({ from: 'bo@example.com', at: AT - 400 * DAY, labelIds: [] }, { quietly: true });
    box.deliver({ from: 'cy@example.com', at: AT - 1500 * DAY, labelIds: [] }, { quietly: true });
    const me = await sift.settled(ME);

    const reach = await me.call('GET', '/api/mail/reach');
    expect(reach.status).toBe(200);
    expect(reach.body).toMatchObject({ year: { messages: 1 }, three_years: { messages: 2 }, all: { messages: 3 } });
    const asked = box.requests.length;
    expect((await me.call('GET', '/api/mail/reach')).body).toEqual(reach.body);
    expect(box.requests).toHaveLength(asked);
  });

  it('copies the inbox and the window chosen, each message read whole once, and lets go of the text when turned off', async () => {
    const sift = await start();
    const box = fake.google.mailbox(ME);
    const lunch = box.deliver({ from: 'Ada <ada@example.com>', subject: 'Lunch?', text: 'Lunch on Friday?', at: AT - 2 * DAY }, { quietly: true });
    const archived = box.deliver({ from: 'bo@example.com', subject: 'Old news', at: AT - 30 * DAY, labelIds: [] }, { quietly: true });
    const outside = box.deliver({ from: 'cy@example.com', subject: 'Older news', at: AT - 400 * DAY, labelIds: [] }, { quietly: true });
    const me = await sift.settled(ME);

    expect((await me.call('POST', '/api/mail/on', { on: true, window: 'year' })).status).toBe(200);
    expect((await me.call('GET', '/api/manage')).body).toMatchObject({ mail: true, mailWindow: 'year' });
    await sift.work();
    for (const id of [lunch, archived]) expect(box.asked('users.messages.get', id)).toEqual([{ method: 'users.messages.get', id, format: 'full' }]);
    expect(box.asked('users.messages.get', outside)).toEqual([]);
    expect((await me.call('GET', `/api/message?id=${lunch}`)).body).toMatchObject({ subject: 'Lunch?', body: 'Lunch on Friday?' });
    expect((await me.call('GET', `/api/message?id=${archived}`)).body).toMatchObject({ subject: 'Old news' });

    expect((await me.call('POST', '/api/mail/on', { on: false })).status).toBe(200);
    expect((await me.call('GET', '/api/manage')).body).toMatchObject({ mail: false });
    expect((await me.call('GET', `/api/message?id=${lunch}`)).body).toMatchObject({ subject: 'Lunch?', body: null, hasHtml: false });
  });
});

describe('reading mail', () => {
  it('lists the inbox’s conversations newest first, and gives one oldest first with each message’s text and HTML', async () => {
    const { box, me, arrives } = await withInbox();
    const first = box.deliver({
      from: 'Ada <ada@example.com>',
      subject: 'Lunch?',
      text: 'Lunch on Friday?',
      html: '<p>Lunch on <b>Friday</b>?</p>',
      at: AT - DAY,
    });
    const reply = box.deliver({ from: 'Ada <ada@example.com>', subject: 'Re: Lunch?', threadId: first, text: 'Or Saturday.', at: AT - 60_000 });
    const older = box.deliver({ from: 'Bo <bo@example.com>', subject: 'Tea?', at: AT - 2 * DAY });
    await arrives();

    const threads = await me.call('GET', '/api/mail/threads');
    expect(threadsOf(threads).map((t) => ({ threadId: t.threadId, subject: t.subject, messageIds: t.messageIds, place: t.place }))).toEqual([
      { threadId: first, subject: 'Re: Lunch?', messageIds: [first, reply], place: 'inbox' },
      { threadId: older, subject: 'Tea?', messageIds: [older], place: 'inbox' },
    ]);
    expect(threadsOf(await me.call('GET', '/api/mail/threads?q=saturday')).map((t) => t.threadId)).toEqual([first]);

    const thread = await me.call('GET', `/api/mail/thread?thread=${first}`);
    expect(thread.status).toBe(200);
    expect(thread.body).toMatchObject({
      threadId: first,
      messages: [
        { messageId: first, fromAddress: 'ada@example.com', preview: 'Lunch on Friday?' },
        { messageId: reply, preview: 'Or Saturday.' },
      ],
    });
    expect((await me.call('GET', `/api/message?id=${reply}`)).body).toMatchObject({
      fromName: 'Ada',
      subject: 'Re: Lunch?',
      body: 'Or Saturday.',
      hasHtml: false,
    });

    const html = await me.call('GET', `/api/message/html?id=${first}`);
    expect(html.status).toBe(200);
    expect(html.body['text']).toContain('<p>Lunch on <b>Friday</b>?</p>');
    expect((await me.call('GET', `/api/message/html?id=${reply}`)).status).toBe(404);
  });

  it('gives a message’s file to save, fetched from Gmail as it is asked for, never shown at Mild’s address', async () => {
    const { box, me, arrives } = await withInbox();
    const id = box.deliver({
      from: 'Ada <ada@example.com>',
      subject: 'Plans',
      attachments: [{ filename: 'Dachplan für Ada.html', mimeType: 'text/html', data: '<script>alert(1)</script>' }],
    });
    await arrives();
    const [file] = ((await me.call('GET', `/api/message?id=${id}`)).body as { attachments: { part: string }[] }).attachments;
    const reads = box.asked('users.messages.get', id).length;

    const saved = await me.call('GET', `/api/message/file?id=${id}&part=${file!.part}`);
    expect(saved.status).toBe(200);
    expect(saved.body['text']).toBe('<script>alert(1)</script>');
    expect(Object.fromEntries(saved.headers)).toMatchObject({
      'content-type': 'text/html',
      'content-disposition': `attachment; filename="Dachplan f_r Ada.html"; filename*=UTF-8''Dachplan%20f%C3%BCr%20Ada.html`,
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    });
    expect(box.asked('users.messages.get', id)).toHaveLength(reads);
    expect((await me.call('GET', `/api/message/file?id=${id}&part=9`)).status).toBe(404);

    // Gone from the message in Gmail since: it is read again once, for the ids it has now, and then refused.
    box.renewAttachmentIds();
    expect((await me.call('GET', `/api/message/file?id=${id}&part=${file!.part}`)).body['text']).toBe('<script>alert(1)</script>');
    expect(box.asked('users.messages.get', id)).toHaveLength(reads + 1);
  });

  it('shows someone else none of it', async () => {
    const { sift, box, arrives } = await withInbox();
    const id = box.deliver({ from: 'ada@example.com', subject: 'Lunch?', html: '<p>Lunch</p>' });
    await arrives();
    const other = await sift.settled(OTHER);
    expect(threadsOf(await other.call('GET', '/api/mail/threads'))).toEqual([]);
    expect((await other.call('GET', `/api/mail/thread?thread=${id}`)).status).toBe(404);
    expect((await other.call('GET', `/api/message?id=${id}`)).status).toBe(404);
    expect((await other.call('GET', `/api/message/html?id=${id}`)).status).toBe(404);
    expect((await other.call('GET', `/api/message/file?id=${id}&part=1`)).status).toBe(404);
    expect((await other.call('GET', `/api/mail/threads?mailbox=${ME}`)).status).toBe(404);
  });
});

describe('changing mail', () => {
  it('archives and marks read in Gmail, as the record then says, and Undo puts it back', async () => {
    const { box, me, arrives } = await withInbox();
    const a = box.deliver({ from: 'ada@example.com', subject: 'One' });
    const b = box.deliver({ from: 'bo@example.com', subject: 'Two' });
    await arrives();

    const read = await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [a], change: 'read' });
    expect(read.body).toMatchObject({ actions: [expect.any(Number)], missed: 0 });
    expect(box.labelsOf(a)).toEqual(['INBOX']);

    const archived = await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [a, b], change: 'archive' });
    expect(archived.status).toBe(200);
    const { actions } = archived.body as { actions: number[] };
    expect(actions).toHaveLength(2);
    expect(box.labelsOf(a)).not.toContain('INBOX');
    expect(box.labelsOf(b)).not.toContain('INBOX');
    expect(threadsOf(await me.call('GET', '/api/mail/threads'))).toEqual([]);

    expect(await me.call('POST', '/api/undo', { id: actions[1] })).toMatchObject({ status: 200, body: { message: null } });
    expect(box.labelsOf(b)).toContain('INBOX');
    expect(threadsOf(await me.call('GET', '/api/mail/threads')).map((t) => t.threadId)).toEqual([b]);
  });

  it('marks a conversation spam as the person’s own press, taken back by Undo', async () => {
    const { box, me, arrives } = await withInbox();
    const deal = box.deliver({ from: 'deals@example.com', subject: 'Deal' });
    await arrives();

    const spam = await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [deal], change: 'spam' });
    expect(spam.body).toMatchObject({ actions: [expect.any(Number)], missed: 0 });
    expect(box.labelsOf(deal)).toContain('SPAM');
    expect(box.labelsOf(deal)).not.toContain('INBOX');
    expect(threadsOf(await me.call('GET', '/api/mail/threads'))).toEqual([]);

    expect((await me.call('POST', '/api/undo', { id: (spam.body as { actions: number[] }).actions[0] })).status).toBe(200);
    expect(box.labelsOf(deal)).toContain('INBOX');
    expect(box.labelsOf(deal)).not.toContain('SPAM');
  });

  it('leaves mail no longer in the inbox as it is', async () => {
    const { box, me, arrives } = await withInbox();
    const id = box.deliver({ from: 'ada@example.com' });
    await arrives();
    box.change(id, { remove: ['INBOX'] });
    expect((await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [id], change: 'read' })).body).toEqual({ actions: [], missed: 0 });
    expect(box.labelsOf(id)).toEqual(['UNREAD']);
  });

  it('returns what landed when a message’s Gmail call throws, with that one counted missed, so Undo still takes the rest back', async () => {
    const { box, me, arrives } = await withInbox();
    const a = box.deliver({ from: 'ada@example.com' });
    const b = box.deliver({ from: 'bo@example.com' });
    await arrives();
    // Gmail's client tries a read four times before it gives up.
    box.fail('users.messages.get', ...Array.from({ length: 4 }, () => ({ status: 503 })));

    const changed = await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [a, b], change: 'archive' });
    expect(changed.status).toBe(200);
    const { actions, missed } = changed.body as { actions: number[]; missed: number };
    expect(missed).toBe(1);
    expect(actions).toHaveLength(1);
    expect(box.labelsOf(a)).toContain('INBOX');
    expect(box.labelsOf(b)).not.toContain('INBOX');

    expect((await me.call('POST', '/api/undo', { id: actions[0] })).status).toBe(200);
    expect(box.labelsOf(b)).toContain('INBOX');
  });

  it('offers Undo for a change whose answer was lost, which takes it back once Gmail shows it landed', async () => {
    const { box, me, arrives } = await withInbox();
    const id = box.deliver({ from: 'ada@example.com' });
    await arrives();
    box.fail('users.messages.modify', 'lost');

    const changed = await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [id], change: 'archive' });
    const { actions } = changed.body as { actions: number[] };
    expect(changed.body).toEqual({ actions: [expect.any(Number)], missed: 0 });
    expect(box.labelsOf(id)).not.toContain('INBOX');

    expect((await me.call('POST', '/api/undo', { id: actions[0] })).status).toBe(200);
    expect(box.labelsOf(id)).toContain('INBOX');
    await arrives();
    expect(threadsOf(await me.call('GET', '/api/mail/threads'))).toHaveLength(1);
  });

  it('offers Undo for a change Gmail never got, which then has nothing to take back', async () => {
    const { box, me, arrives } = await withInbox();
    const id = box.deliver({ from: 'ada@example.com' });
    await arrives();
    box.fail('users.messages.modify', 'network');

    const { actions } = (await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [id], change: 'archive' })).body as { actions: number[] };
    expect(actions).toHaveLength(1);
    expect(box.labelsOf(id)).toContain('INBOX');
    expect((await me.call('POST', '/api/undo', { id: actions[0] })).status).toBe(200);
    expect(box.asked('users.messages.modify')).toHaveLength(1);
    expect(box.labelsOf(id)).toContain('INBOX');
  });

  it('refuses an Undo Gmail refuses, leaving the change in place to be undone again', async () => {
    const { box, me, arrives } = await withInbox();
    const id = box.deliver({ from: 'ada@example.com' });
    await arrives();
    const { actions } = (await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [id], change: 'archive' })).body as { actions: number[] };
    box.fail('users.messages.modify', { status: 500 });

    expect((await me.call('POST', '/api/undo', { id: actions[0] })).status).toBe(409);
    expect(box.labelsOf(id)).not.toContain('INBOX');
    expect((await me.call('POST', '/api/undo', { id: actions[0] })).status).toBe(200);
    expect(box.labelsOf(id)).toContain('INBOX');
  });

  it('changes and undoes nothing of someone else’s', async () => {
    const { sift, box, me, arrives } = await withInbox();
    const id = box.deliver({ from: 'ada@example.com' });
    await arrives();
    const { actions } = (await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [id], change: 'read' })).body as { actions: number[] };
    const other = await sift.settled(OTHER);
    const asked = box.requests.length;

    expect((await other.call('POST', '/api/mail/change', { accountId: ME, messageIds: [id], change: 'archive' })).status).toBe(404);
    expect(await other.call('POST', '/api/undo', { id: actions[0] })).toMatchObject({ status: 409, body: { error: `There is no change #${actions[0]}.` } });
    expect(box.requests).toHaveLength(asked);
    expect(box.labelsOf(id)).toEqual(['INBOX']);
  });
});

describe('a press that says what the mail is', () => {
  type Example = { messageId: string; labelId: string };
  const examplesOf = async (me: Browser) => (await me.call('GET', '/api/examples')).body['examples'] as Example[];
  const archive = async (me: Browser, id: string) =>
    (await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [id], change: 'archive' })).body as { actions: number[] };

  /** Receipts set to Digest, and a receipt in the inbox the model read as `labelId`, Mild off. */
  async function placed(labelId: string, disposition: 'archive' | 'keep' = 'archive') {
    const { sift, box, me, arrives } = await withInbox();
    expect((await me.call('POST', '/api/labels', { id: 'receipts', disposition: 'digest' })).status).toBe(200);
    const id = box.deliver({ from: 'Shop <shop@example.com>', subject: 'Your receipt' });
    await arrives();
    await sift.judged(ME, id, labelId, disposition);
    return { sift, box, me, id };
  }

  it('does what the row’s label does when the press is what it does, and keeps the label as the answer', async () => {
    const { box, me, id } = await placed('receipts');
    const { actions } = await archive(me, id);
    expect(actions).toHaveLength(1);
    expect(box.labelsOf(id)).toEqual(['UNREAD', box.labelId('mild/receipts')]);
    expect(await examplesOf(me)).toMatchObject([{ messageId: id, labelId: 'receipts' }]);
    expect(((await me.call('GET', '/api/decisions')).body['rows'] as unknown[])[0]).toMatchObject({
      messageId: id,
      labelId: 'receipts',
      byUser: true,
      carryOut: true,
      actionStatus: 'done',
    });

    expect((await me.call('POST', '/api/undo', { id: actions[0] })).status).toBe(200);
    expect(box.labelsOf(id)).toContain('INBOX');
  });

  it('does it for an answer that was only said, in Inbox’s reader', async () => {
    const { box, me, id } = await placed('everything_else', 'keep');
    const said = await me.call('POST', '/api/feedback', { accountId: ME, sender: 'shop@example.com', label: 'receipts', messageId: id, carryOut: false });
    expect(said.status).toBe(200);
    expect(box.labelsOf(id)).toContain('INBOX');
    await archive(me, id);
    expect(box.labelsOf(id)).toEqual(['UNREAD', box.labelId('mild/receipts')]);
  });

  it('only records the label when the press does something else, and the press goes ahead', async () => {
    const { box, me, id } = await placed('everything_else', 'keep');
    await archive(me, id);
    expect(box.labelsOf(id)).toEqual(['UNREAD']);
    expect(await examplesOf(me)).toMatchObject([{ messageId: id, labelId: 'everything_else' }]);
  });

  it('records a label that archives on mail marked spam, which is still spam', async () => {
    const { box, me, id } = await placed('receipts');
    await me.call('POST', '/api/mail/change', { accountId: ME, messageIds: [id], change: 'spam' });
    expect(box.labelsOf(id)).toEqual(['UNREAD', 'SPAM']);
    expect(await examplesOf(me)).toMatchObject([{ messageId: id, labelId: 'receipts' }]);
  });

  it('is only the press for mail Mild never placed', async () => {
    const { box, me, arrives } = await withInbox();
    const id = box.deliver({ from: 'ada@example.com' });
    await arrives();
    await archive(me, id);
    expect(box.labelsOf(id)).toEqual(['UNREAD']);
    expect(await examplesOf(me)).toEqual([]);
  });
});

describe('sending mail', () => {
  /** What the composer sends for a press of Send: `id` is the Message-ID it made for that press. */
  const written = (id: string) => ({
    accountId: ME,
    id,
    from: { address: ME, name: 'Me' },
    to: [{ address: 'ada@example.com', name: 'Ada' }],
    cc: [],
    bcc: [],
    text: 'See you Friday.',
    uploads: [] as string[],
  });
  const mail = (id: string, more: Record<string, unknown> = {}) => ({ ...written(id), subject: 'Friday', ...more });

  /** `withInbox`, with Google letting Mild send from the mailbox. */
  async function canSend() {
    const ready = await withInbox();
    await ready.me.signIn(ME, { send: true });
    return ready;
  }

  it('sends what was written as the person, and keeps it in the record', async () => {
    const { box, me } = await canSend();
    const sent = await me.call('POST', '/api/mail/send', mail('<friday.1@example.org>'));
    expect(sent.status).toBe(200);
    const { id, threadId } = sent.body as { id: string; threadId: string };
    expect(box.sent()).toHaveLength(1);
    const went = box.message(id)!;
    expect(went.header('from')).toBe('"Me" <me@example.org>');
    expect(went.header('to')).toBe('"Ada" <ada@example.com>');
    expect(went.header('subject')).toBe('Friday');
    expect(went.header('message-id')).toBe('<friday.1@example.org>');
    expect((await me.call('GET', `/api/mail/thread?thread=${threadId}`)).body).toMatchObject({ messages: [{ messageId: id, preview: 'See you Friday.' }] });
  });

  it('answers a message in its conversation, naming the one it answers', async () => {
    const { box, me, arrives } = await canSend();
    const asked = box.deliver({ from: 'Ada <ada@example.com>', subject: 'Lunch?' });
    await arrives();
    const sent = await me.call('POST', '/api/mail/send', { ...written('<re.1@example.org>'), replyTo: { messageId: asked } });
    expect(sent.status).toBe(200);
    const went = box.message((sent.body as { id: string }).id)!;
    expect(went.threadId).toBe(asked);
    expect(went.header('subject')).toBe('Re: Lunch?');
    expect(went.header('in-reply-to')).toBe(`<${asked}@mail.example.com>`);
  });

  it('refuses with Inbox off, or from a mailbox Google has not let it send from', async () => {
    const { box, me } = await withInbox();
    expect(await me.call('POST', '/api/mail/send', mail('<a.1@example.org>'))).toMatchObject({
      status: 409,
      body: { error: `Google has not let Mild send from ${ME}.` },
    });
    await me.signIn(ME, { send: true });
    await me.call('POST', '/api/mail/on', { on: false });
    expect(await me.call('POST', '/api/mail/send', mail('<a.1@example.org>'))).toMatchObject({
      status: 409,
      body: { error: 'Turn Inbox on to send mail from Mild.' },
    });
    expect(box.asked('users.messages.send')).toEqual([]);
  });

  it('sends once when Gmail lost its answer: a retry is refused until Gmail’s search finds what went, then answers with it', async () => {
    const { box, me } = await canSend();
    box.lagSearch = true;
    box.fail('users.messages.send', 'lost');
    const press = mail('<lost.1@example.org>');

    expect((await me.call('POST', '/api/mail/send', press)).status).toBe(500);
    expect(box.sent()).toHaveLength(1);
    expect(await me.call('POST', '/api/mail/send', press)).toMatchObject({ status: 409, body: { error: expect.stringContaining('cannot tell yet') } });
    box.index();
    const found = await me.call('POST', '/api/mail/send', press);
    expect(found).toMatchObject({ status: 200, body: { id: box.sent()[0]!.id } });
    expect(box.asked('users.messages.send')).toHaveLength(1);
    expect(box.sent()).toHaveLength(1);
  });

  it('answers a press tried again after Gmail took it with what went, files and all, never sending it twice', async () => {
    const { box, me } = await canSend();
    const { id: upload } = (await me.call('POST', '/api/mail/upload', { name: 'a.txt', type: 'text/plain', size: 2 })).body as { id: string };
    expect((await me.call('POST', '/api/mail/upload/piece', { id: upload, piece: 0, data: Buffer.from('hi').toString('base64') })).status).toBe(200);
    const press = mail('<twice.1@example.org>', { uploads: [upload] });
    const first = await me.call('POST', '/api/mail/send', press);
    expect(first.status).toBe(200);

    // The page never heard, and presses Send again.
    expect(await me.call('POST', '/api/mail/send', press)).toMatchObject({ status: 200, body: first.body });
    expect(box.asked('users.messages.send')).toHaveLength(1);
    expect(box.sent()).toHaveLength(1);
  });

  it('sends again once a try that never reached Gmail has settled, and an edited draft goes as new mail', async () => {
    const { box, me } = await canSend();
    box.fail('users.messages.send', 'network');
    const press = mail('<retry.1@example.org>');

    expect((await me.call('POST', '/api/mail/send', press)).status).toBe(500);
    expect(box.sent()).toEqual([]);
    expect((await me.call('POST', '/api/mail/send', press)).status).toBe(409);
    vi.setSystemTime(Date.now() + SETTLE_MS);
    expect((await me.call('POST', '/api/mail/send', press)).status).toBe(200);
    expect(box.sent().map((m) => m.header('message-id'))).toEqual(['<retry.1@example.org>']);

    const edited = await me.call('POST', '/api/mail/send', mail('<retry.2@example.org>', { text: 'See you Saturday.' }));
    expect(edited.status).toBe(200);
    expect(box.sent().map((m) => m.header('message-id'))).toEqual(['<retry.1@example.org>', '<retry.2@example.org>']);
  });

  it('sends to Bcc, whom only the sent copy names, and keeps them in the record', async () => {
    const { box, me } = await canSend();
    const sent = await me.call('POST', '/api/mail/send', mail('<bcc.1@example.org>', { bcc: [{ address: 'bo@example.com', name: 'Bo' }] }));
    expect(sent.status).toBe(200);
    const { id } = sent.body as { id: string };
    expect(box.message(id)!.header('bcc')).toBe('"Bo" <bo@example.com>');
    expect((await me.call('GET', `/api/message?id=${id}`)).body).toMatchObject({ headers: { bcc: '"Bo" <bo@example.com>' } });
  });

  it('attaches files uploaded in pieces, which go once the mail has', async () => {
    const { box, me } = await canSend();
    // Over one piece, so it comes in two.
    const plans = Buffer.alloc(3_500_000, 7);
    const started = await me.call('POST', '/api/mail/upload', { name: 'Plans – roof.pdf', type: 'application/pdf', size: plans.length });
    expect(started.status).toBe(200);
    const { id: upload, piece } = started.body as { id: string; piece: number };
    expect(await me.call('POST', '/api/mail/send', mail('<files.1@example.org>', { uploads: [upload] }))).toMatchObject({ status: 409 });
    for (let at = 0, index = 0; at < plans.length; at += piece, index++)
      expect(
        (await me.call('POST', '/api/mail/upload/piece', { id: upload, piece: index, data: plans.subarray(at, at + piece).toString('base64') })).status,
      ).toBe(200);

    const sent = await me.call('POST', '/api/mail/send', mail('<files.1@example.org>', { uploads: [upload] }));
    expect(sent.status).toBe(200);
    const [file] = filesOf(box.message((sent.body as { id: string }).id)!.raw);
    expect(file).toMatchObject({ name: 'Plans – roof.pdf', type: 'application/pdf' });
    expect(file!.data.equals(plans)).toBe(true);
    expect(await me.call('POST', '/api/mail/upload/piece', { id: upload, piece: 0, data: 'AA==' })).toMatchObject({
      status: 409,
      body: { error: 'That file is no longer attached. Attach it again.' },
    });
  });

  it('refuses a file over 25 MB, a piece of the wrong size, and one taken off', async () => {
    const { me } = await canSend();
    expect((await me.call('POST', '/api/mail/upload', { name: 'scan.tiff', type: 'image/tiff', size: 30_000_000 })).status).toBe(400);
    const { id } = (await me.call('POST', '/api/mail/upload', { name: 'a.txt', type: 'text/plain', size: 3 })).body as { id: string };
    expect((await me.call('POST', '/api/mail/upload/piece', { id, piece: 0, data: 'AAAAAA==' })).status).toBe(409);
    expect((await me.call('POST', '/api/mail/upload/remove', { id })).status).toBe(200);
    expect(await me.call('POST', '/api/mail/send', mail('<gone.1@example.org>', { uploads: [id] }))).toMatchObject({
      status: 409,
      body: { error: 'An attachment did not finish uploading. Remove it and attach it again.' },
    });
  });

  it('forwards a message with the files left on it, fetched from Gmail as it goes, the message itself not read again', async () => {
    const { box, me, arrives } = await canSend();
    const asked = box.deliver({
      from: 'Ada <ada@example.com>',
      subject: 'Plans',
      text: 'Both attached.',
      attachments: [
        { filename: 'roof.pdf', mimeType: 'application/pdf', data: 'roof' },
        { filename: 'notes.txt', mimeType: 'text/plain', data: 'notes' },
      ],
    });
    await arrives();
    const detail = (await me.call('GET', `/api/message?id=${asked}`)).body as { attachments: { part: string; name: string; size: number }[] };
    expect(detail.attachments.map((a) => a.name)).toEqual(['roof.pdf', 'notes.txt']);
    const reads = box.asked('users.messages.get', asked).length;

    const forward = { ...mail('<fwd.1@example.org>', { subject: 'Fwd: Plans' }), forwarding: { messageId: asked, parts: [detail.attachments[0]!.part] } };
    const sent = await me.call('POST', '/api/mail/send', forward);
    expect(sent.status).toBe(200);
    expect(filesOf(box.message((sent.body as { id: string }).id)!.raw).map((f) => [f.name, f.data.toString()])).toEqual([['roof.pdf', 'roof']]);
    expect(box.asked('users.messages.get', asked)).toHaveLength(reads);

    // Ids Gmail gave at the first read that it no longer takes: the message is read again once, for the ids it has now.
    box.renewAttachmentIds();
    const again = await me.call('POST', '/api/mail/send', { ...forward, id: '<fwd.2@example.org>' });
    expect(again.status).toBe(200);
    expect(filesOf(box.message((again.body as { id: string }).id)!.raw).map((f) => f.name)).toEqual(['roof.pdf']);
    expect(box.asked('users.messages.get', asked)).toHaveLength(reads + 1);
    expect((await me.call('POST', '/api/mail/attachments', { accountId: ME, messageId: asked })).body).toMatchObject({
      attachments: [{ name: 'roof.pdf' }, { name: 'notes.txt' }],
    });
    expect(box.asked('users.messages.get', asked)).toHaveLength(reads + 1);
  });

  it('sends a reply under a subject of its own as a conversation of its own, and with the files of the message it answers', async () => {
    const { box, me, arrives } = await canSend();
    const asked = box.deliver({
      from: 'Ada <ada@example.com>',
      subject: 'Plans',
      attachments: [{ filename: 'roof.pdf', mimeType: 'application/pdf', data: 'roof' }],
    });
    await arrives();
    const [file] = ((await me.call('GET', `/api/message?id=${asked}`)).body as { attachments: { part: string }[] }).attachments;
    const reply = { ...written('<re.2@example.org>'), replyTo: { messageId: asked } };

    const own = await me.call('POST', '/api/mail/send', { ...reply, subject: 'Roof, again', forwarding: { messageId: asked, parts: [file!.part] } });
    expect(own.status).toBe(200);
    const went = box.message((own.body as { id: string }).id)!;
    expect(went.header('subject')).toBe('Roof, again');
    expect(went.header('in-reply-to')).toBe(`<${asked}@mail.example.com>`);
    expect(went.threadId).not.toBe(asked);
    expect(filesOf(went.raw).map((f) => f.name)).toEqual(['roof.pdf']);

    // Only the message answered gives its files.
    const other = box.deliver({ from: 'Bo <bo@example.com>', subject: 'Other' });
    await arrives();
    expect((await me.call('POST', '/api/mail/send', { ...reply, id: '<re.3@example.org>', forwarding: { messageId: other, parts: ['1'] } })).status).toBe(400);
  });

  it('suggests, as an address is typed, whom the person wrote to, then who wrote to them, never a list', async () => {
    const { box, me, arrives } = await canSend();
    box.deliver({ from: 'Ada Lovelace <ada@example.com>', subject: 'Hello' });
    box.deliver({
      from: 'Adverts <ads@example.net>',
      subject: 'Sale',
      headers: { 'List-Id': '<offers.example.net>', 'List-Unsubscribe': '<https://example.net/u>' },
    });
    await arrives();
    expect((await me.call('POST', '/api/mail/send', mail('<adam.1@example.org>', { to: [{ address: 'adam@example.org', name: 'Adam Smith' }] }))).status).toBe(
      200,
    );

    const suggested = async (q: string) =>
      ((await me.call('GET', `/api/mail/addresses?q=${encodeURIComponent(q)}`)).body as { addresses: { address: string }[] }).addresses.map((a) => a.address);
    expect(await suggested('ad')).toEqual(['adam@example.org', 'ada@example.com']);
    expect(await suggested('love')).toEqual(['ada@example.com']);
    expect(await suggested('ada lov')).toEqual(['ada@example.com']);
    expect(await suggested('example.net')).toEqual([]);
    expect(await suggested('')).toEqual([]);
  });

  it('sends nothing from someone else’s mailbox', async () => {
    const { sift, box } = await canSend();
    const other = await sift.settled(OTHER);
    expect((await other.call('POST', '/api/mail/send', mail('<theirs.1@example.org>'))).status).toBe(404);
    expect(box.asked('users.messages.send')).toEqual([]);
  });
});

describe('drafts', () => {
  const writing = (more: Record<string, unknown> = {}) => ({
    of: { kind: 'new' },
    from: ME,
    to: [{ address: 'ada@example.com', name: 'Ada' }],
    cc: [],
    bcc: [],
    showCc: false,
    showBcc: false,
    subject: 'Plans',
    text: 'Half written.',
    files: [],
    dropped: [],
    id: null,
    at: Date.now(),
    ...more,
  });
  const save = (me: Browser, id: string, more: Record<string, unknown> = {}) =>
    me.call('POST', '/api/mail/drafts/save', { id, accountId: ME, writing: writing(more) });
  const listed = async (me: Browser) =>
    ((await me.call('GET', '/api/mail/drafts')).body as { drafts: { id: string; writing: { text: string }; inGmail: boolean }[] }).drafts;
  /** A pass, once the draft has been left alone long enough for Gmail to hear of it. */
  const quiet = async (arrives: () => Promise<void>) => {
    vi.setSystemTime(Date.now() + DRAFT_QUIET_MS);
    await arrives();
  };

  it('are kept as they are written, the newer of two copies, and given to Gmail once left alone a while, in place of what it had', async () => {
    const { box, me, arrives } = await withInbox();
    expect((await save(me, 'd1')).status).toBe(200);
    // An older copy, from a device that had not heard of the newer.
    expect((await save(me, 'd1', { text: 'Older.', at: Date.now() - 1000 })).status).toBe(200);
    expect(await listed(me)).toMatchObject([{ id: 'd1', writing: { text: 'Half written.' }, inGmail: false }]);

    await arrives();
    expect(box.draftsHeld().size).toBe(0);
    await quiet(arrives);
    const [gmailId, held] = [...box.draftsHeld()][0]!;
    expect(held.header('to')).toBe('"Ada" <ada@example.com>');
    expect(held.labelIds).toEqual(['DRAFT']);
    expect(await listed(me)).toMatchObject([{ inGmail: true }]);
    // Gmail's Drafts are not mail: nothing of them is recorded, so nothing triages them.
    expect(box.asked('users.messages.get', held.id)).toEqual([]);

    expect((await save(me, 'd1', { text: 'Written.', at: Date.now() })).status).toBe(200);
    await quiet(arrives);
    expect([...box.draftsHeld().keys()]).toEqual([gmailId]);
    expect(box.draftsHeld().get(gmailId)!.raw).toContain(Buffer.from('Written.').toString('base64'));
  });

  it('go once sent, here and in Gmail, and once discarded', async () => {
    const { box, me, arrives } = await withInbox();
    await me.signIn(ME, { send: true });
    await save(me, 'd1');
    await save(me, 'd2', { subject: 'Other' });
    await quiet(arrives);
    expect(box.draftsHeld().size).toBe(2);

    const press = {
      accountId: ME,
      id: '<d1.1@example.org>',
      from: { address: ME },
      to: [{ address: 'ada@example.com' }],
      cc: [],
      bcc: [],
      text: 'Done.',
      uploads: [],
      subject: 'Plans',
      draft: 'd1',
    };
    expect((await me.call('POST', '/api/mail/send', press)).status).toBe(200);
    expect((await me.call('POST', '/api/mail/drafts/remove', { id: 'd2' })).status).toBe(200);
    expect(await listed(me)).toEqual([]);
    expect(box.draftsHeld().size).toBe(0);
  });

  describe('scheduled', () => {
    const HOUR = 3_600_000;
    const schedule = (me: Browser, id: string, sendAt: number, more: Record<string, unknown> = {}) =>
      me.call('POST', '/api/mail/drafts/save', { id, accountId: ME, writing: writing({ id: `<${id}@example.org>`, ...more }), sendAt });

    it('go at their time, once, as the press of Send would have sent them, and then are no draft', async () => {
      const { box, me, arrives } = await withInbox();
      await me.signIn(ME, { send: true });
      expect((await schedule(me, 's1', Date.now() + HOUR)).status).toBe(200);
      await quiet(arrives);
      expect(box.sent()).toEqual([]);
      expect(await listed(me)).toMatchObject([{ id: 's1', sendAt: Date.now() - DRAFT_QUIET_MS + HOUR, inGmail: true }]);

      vi.setSystemTime(Date.now() + HOUR);
      await arrives();
      await arrives();
      expect(box.sent().map((m) => m.header('message-id'))).toEqual(['<s1@example.org>']);
      expect(await listed(me)).toEqual([]);
      expect(box.draftsHeld().size).toBe(0);
    });

    it('sent or deleted in Gmail first are not sent, and what cannot go is a draft again, saying why', async () => {
      const { box, me, arrives } = await withInbox();
      await me.signIn(ME, { send: true });
      await schedule(me, 's1', Date.now() + HOUR);
      await schedule(me, 's2', Date.now() + HOUR, { to: [{ address: 'nope', wrong: true }] });
      expect(await schedule(me, 's3', Date.now() + HOUR, { to: [] })).toMatchObject({ status: 409, body: { error: 'Say who the mail is to.' } });
      await quiet(arrives);
      box.dropDraft([...box.draftsHeld().keys()][0]!);

      vi.setSystemTime(Date.now() + HOUR);
      await arrives();
      expect(box.sent()).toEqual([]);
      expect(await listed(me)).toEqual([]);
    });

    it('a draft scheduled while Inbox is on, sent once it is off, waits as a draft, saying why', async () => {
      const { box, me, arrives } = await withInbox();
      await me.signIn(ME, { send: true });
      await schedule(me, 's1', Date.now() + HOUR);
      expect((await me.call('POST', '/api/mail/on', { on: false })).status).toBe(200);
      vi.setSystemTime(Date.now() + HOUR);
      await arrives();
      expect(box.sent()).toEqual([]);
      expect(await listed(me)).toMatchObject([{ id: 's1', sendAt: null, sendError: 'Turn Inbox on to send mail from Mild.' }]);
    });
  });

  it('give Gmail a reply in its conversation, to nobody yet if so', async () => {
    const { box, me, arrives } = await withInbox();
    const asked = box.deliver({ from: 'Ada <ada@example.com>', subject: 'Lunch?' });
    await arrives();
    await save(me, `reply/${asked}`, { of: { kind: 'reply', messageId: asked, all: false }, to: [], subject: '' });
    await quiet(arrives);
    const [held] = [...box.draftsHeld().values()];
    expect(held).toMatchObject({ threadId: asked });
    expect(held!.header('subject')).toBe('Re: Lunch?');
  });
});

describe('asking Inbox in words', () => {
  it('turns the words into a filter on the list, naming only senders Mild has recorded', async () => {
    const model = fauxModel();
    const { box, me, arrives } = await withInbox(model);
    box.deliver({ from: 'Vendor <billing@vendor.example.com>', subject: 'Your invoice' });
    await arrives();
    const blank = { reading: '', from: [], domains: [], label: '', view: '', unread: false, since: '', words: [], note: '' };
    model.answers(toolReply(FIND_TOOL, { query: 'vendor' }), toolReply(ASK_TOOL, { ...blank, from: ['billing@vendor.example.com'], words: ['invoice'] }));

    const asked = await me.call('POST', '/api/mail/ask', { words: 'invoices from the vendor', today: '2026-11-18' });
    expect(asked).toMatchObject({ status: 200, body: { filter: { from: ['billing@vendor.example.com'], words: ['invoice'] } } });
    expect(threadsOf(await me.call('GET', '/api/mail/threads?from=billing@vendor.example.com&q=invoice')).map((t) => t.subject)).toEqual(['Your invoice']);
  });

  it('is refused with Inbox off, without asking the model', async () => {
    const model = fauxModel();
    const { me } = await withInbox(model);
    await me.call('POST', '/api/mail/on', { on: false });
    expect(await me.call('POST', '/api/mail/ask', { words: 'invoices', today: '2026-11-18' })).toMatchObject({
      status: 409,
      body: { error: 'Turn Inbox on first.' },
    });
  });
});

everyRouteAnswered('mail');
