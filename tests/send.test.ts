import { globSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { undo } from '../src/actions/executor.ts';
import { type Outgoing, buildMessage, newMessageId, sendMail } from '../src/actions/send.ts';
import { setCanSend, setMailboxAliases } from '../src/store/accounts.ts';
import { getAction } from '../src/store/actions.ts';
import { setMail } from '../src/store/preferences.ts';
import type { Sql } from '../src/store/sql.ts';
import { openUserDb, raw } from './fixtures.ts';
import { ACCOUNT, FakeMailbox } from './helpers.ts';

const AT = Date.UTC(2026, 10, 19, 8, 30);
const ID = '<a1b2@example.org>';
const mail = (more: Partial<Outgoing> = {}): Outgoing => ({
  from: { address: ACCOUNT, name: 'Me' },
  to: [{ address: 'ada@example.com', name: 'Ada' }],
  cc: [],
  subject: 'Lunch',
  text: 'See you at noon.\nBring the plans.',
  ...more,
});

/** The headers of a built message, unfolded, by name. */
function headersOf(raw: string): Record<string, string> {
  const head = raw.slice(0, raw.indexOf('\r\n\r\n')).replaceAll('\r\n ', ' ');
  return Object.fromEntries(head.split('\r\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]));
}

/** RFC 2047 encoded words, decoded. */
const decoded = (value: string) => value.replaceAll(/=\?UTF-8\?B\?([^?]*)\?=\s?/g, (_, data: string) => Buffer.from(data, 'base64').toString('utf8')).trim();

describe('building a message', () => {
  it('is plain text in UTF-8, with every line ended by CRLF and the body as base64', () => {
    const raw = buildMessage(mail(), ID, AT);
    expect(raw).not.toMatch(/[^\r]\n/);
    expect(headersOf(raw)).toMatchObject({
      From: '"Me" <me@example.org>',
      To: '"Ada" <ada@example.com>',
      Subject: 'Lunch',
      Date: 'Thu, 19 Nov 2026 08:30:00 +0000',
      'Message-ID': ID,
      'Content-Type': 'text/plain; charset=UTF-8',
      'Content-Transfer-Encoding': 'base64',
    });
    const body = raw.slice(raw.indexOf('\r\n\r\n') + 4);
    expect(body.split('\r\n').every((line) => line.length <= 76)).toBe(true);
    expect(Buffer.from(body.replaceAll('\r\n', ''), 'base64').toString('utf8')).toBe('See you at noon.\r\nBring the plans.');
  });

  it('encodes a subject and names outside ASCII, splitting no character, in words short enough for any reader', () => {
    const subject = `Café menu ${'✓'.repeat(40)} 日本語`;
    const raw = buildMessage(mail({ subject, to: [{ address: 'zoe@example.com', name: 'Zoë "Z" Ångström' }] }), ID, AT);
    const headers = headersOf(raw);
    expect(decoded(headers['Subject']!)).toBe(subject);
    expect(decoded(headers['To']!.replace(' <zoe@example.com>', ''))).toBe('Zoë "Z" Ångström');
    for (const word of raw.match(/=\?UTF-8\?B\?[^?]*\?=/g)!) expect(word.length).toBeLessThanOrEqual(75);
    expect(buildMessage(mail({ to: [{ address: 'a@example.com', name: 'O"Brien \\ Co' }] }), ID, AT)).toContain('To: "O\\"Brien \\\\ Co" <a@example.com>');
  });

  it('names the message it answers, and the thread before it', () => {
    const raw = buildMessage(mail({ subject: 'Re: Lunch', inReplyTo: '<x2@example.com>', references: ['<x1@example.com>', '<x2@example.com>'] }), ID, AT);
    expect(headersOf(raw)).toMatchObject({ 'In-Reply-To': '<x2@example.com>', References: '<x1@example.com> <x2@example.com>' });
  });

  it('refuses anything that could add a header or a recipient', () => {
    const refused = [
      mail({ subject: 'Hi\r\nBcc: eve@example.net' }),
      mail({ subject: 'Hi\nBcc: eve@example.net' }),
      mail({ subject: 'Hi\u0000' }),
      mail({ to: [{ address: 'ada@example.com', name: 'Ada\r\nBcc: eve@example.net' }] }),
      mail({ to: [{ address: 'ada@example.com\r\nBcc: eve@example.net' }] }),
      mail({ to: [{ address: 'ada@example.com, eve@example.net' }] }),
      mail({ to: [{ address: 'Ada <ada@example.com>' }] }),
      mail({ to: [{ address: 'ada' }] }),
      mail({ cc: [{ address: '"eve"@example.net' }] }),
      mail({ from: { address: 'me@example.org>\r\nBcc: eve@example.net' } }),
      mail({ inReplyTo: '<x@example.com>\r\nBcc: eve@example.net' }),
      mail({ references: ['<x@example.com> <y@example.com>'] }),
      mail({ to: [], cc: [] }),
    ];
    for (const m of refused) expect(() => buildMessage(m, ID, AT), JSON.stringify(m)).toThrow();
    expect(() => buildMessage(mail(), '<x@example.org>\r\nBcc: eve@example.net', AT)).toThrow();
  });
});

describe('sending', () => {
  let db: Sql;
  let mailbox: FakeMailbox;
  const send = (id = ID, more: Partial<Outgoing> = {}) =>
    sendMail({ db, mailbox, now: () => AT }, { accountId: ACCOUNT, id, threadId: 't1', mail: mail(more) });
  const tries = async () => await raw(db).all('SELECT type, status, message_id FROM actions ORDER BY id');

  beforeEach(async () => {
    db = await openUserDb(ACCOUNT);
    mailbox = new FakeMailbox();
  });

  it('is only for someone with Inbox on, from a mailbox Google let send, as one of its own addresses', async () => {
    await expect(send()).rejects.toThrow('Turn Inbox on');
    await setMail(db, true);
    await expect(send()).rejects.toThrow('Google has not let Sift send');
    await setCanSend(db, ACCOUNT, true);
    await expect(send(ID, { from: { address: 'someone@example.com' } })).rejects.toThrow('is not an address of');
    expect(mailbox.sent.size).toBe(0);
    expect(await tries()).toEqual([]);

    await setMailboxAliases(db, ACCOUNT, ['me@work.example.com']);
    expect(await send(ID, { from: { address: 'me@work.example.com' } })).toBe('sent-1');
    expect(mailbox.sent.get('sent-1')).toMatchObject({ threadId: 't1' });
  });

  describe('once allowed', () => {
    beforeEach(async () => {
      await setMail(db, true);
      await setCanSend(db, ACCOUNT, true);
    });

    it('is written to the audit log first, naming who it went to and its subject, and settled from Gmail’s answer', async () => {
      expect(await send()).toBe('sent-1');
      expect(await getAction(db, 1)).toMatchObject({
        type: 'send',
        status: 'done',
        finalLabels: ['SENT'],
        payload: { send: { messageId: ID, to: ['ada@example.com'], cc: [], subject: 'Lunch' } },
      });
      const [stored] = await raw(db).all<{ payload: string }>('SELECT payload FROM actions');
      expect(stored!.payload).toMatch(/^sift-plain:/);
    });

    it('does not send twice when the answer to a try that went was lost', async () => {
      mailbox.failSend = 'after';
      await expect(send()).rejects.toThrow('timeout');
      expect(await tries()).toEqual([{ type: 'send', status: 'unknown', message_id: null }]);
      mailbox.failSend = null;
      expect(await send()).toBe('sent-1');
      expect(mailbox.sent.size).toBe(1);
      expect(await tries()).toEqual([{ type: 'send', status: 'done', message_id: null }]);
    });

    it('sends again when the try before it never went', async () => {
      mailbox.failSend = 'before';
      await expect(send()).rejects.toThrow('network down');
      mailbox.failSend = null;
      expect(await send()).toBe('sent-1');
      expect(await tries()).toEqual([
        { type: 'send', status: 'failed', message_id: null },
        { type: 'send', status: 'done', message_id: null },
      ]);
      // Another press is mail of its own.
      expect(await send(newMessageId(ACCOUNT))).toBe('sent-2');
    });

    it('cannot be undone', async () => {
      await send();
      await expect(undo({ db, mailbox }, 1)).rejects.toThrow('cannot be taken back');
    });
  });
});

it('reaches Gmail only through src/actions/send.ts, which the Gmail mailbox carries out', () => {
  const callers = globSync('src/**/*.ts').filter((file) => /\.send\(/.test(readFileSync(file, 'utf8')));
  expect(callers.toSorted()).toEqual(['src/actions/send.ts', 'src/gmail/mailbox.ts']);
});
