import { describe, expect, it } from 'vitest';
import { type Digest, type DigestEntry, LISTED, toRfc822, writeDigest } from '../src/digest/mail.ts';
import { HOUR } from './helpers.ts';

const until = Date.UTC(2026, 10, 18, 15, 0);

const entry = (
  id: string,
  hoursAgo: number,
  subject: string,
  from: DigestEntry['from'] = { name: 'Builds', address: 'builds@ci.example.org' },
): DigestEntry => ({
  mailbox: 'me@example.org',
  id,
  from,
  subject,
  receivedAt: until - hoursAgo * HOUR,
});

const digest = (over: Partial<Digest> = {}): Digest => ({
  label: { id: 'notifications', name: 'Notifications', gmailLabel: 'mild/notifications' },
  mailbox: 'me@example.org',
  since: until - 24 * HOUR,
  until,
  entries: [entry('a1', 5, 'Run passed'), entry('a2', 1, 'Run failed'), entry('a3', 3, 'Run passed again')],
  highlights: [],
  timeZone: 'America/Los_Angeles',
  ...over,
});

const decode = (raw: string) => {
  const [, ...parts] = raw.split('--sift-digest-part');
  return parts
    .filter((p) => !p.startsWith('--'))
    .map((p) => {
      const [head = '', body = ''] = p.split('\r\n\r\n');
      return {
        type: /Content-Type: ([^;]+)/.exec(head)?.[1],
        body: new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) => c.charCodeAt(0))),
      };
    });
};

describe('writeDigest', () => {
  it('lists newest first, in the person’s own time', () => {
    const { text } = writeDigest(digest());
    expect(text.indexOf('Run failed')).toBeLessThan(text.indexOf('Run passed again'));
    expect(text.indexOf('Run passed again')).toBeLessThan(text.indexOf('Run passed\n'));
    expect(text).toContain('Builds (3)\n  6:00 AM  Run failed');
  });

  it('puts the sender with the most mail first, and the same subject on one line', () => {
    const news = { name: 'News', address: 'news@example.com' };
    const { text } = writeDigest(
      digest({
        entries: [entry('n1', 0.5, 'Morning edition', news), entry('a1', 1, 'Run failed'), entry('a2', 2, 'Run failed'), entry('a3', 3, 'Run passed')],
      }),
    );
    expect(text.indexOf('Builds (3)')).toBeLessThan(text.indexOf('News (1)'));
    expect(text).toContain('6:00 AM  Run failed\u00a0×2\n  https://mail.google.com/mail/u/me%40example.org/#all/a1');
    expect(text).not.toContain('#all/a2');
  });

  it('lists what is worth a look only there', () => {
    const { text } = writeDigest(digest({ highlights: [{ id: 'a2', why: 'The only failure.' }] }));
    expect(text.match(/Run failed/g)).toHaveLength(1);
    expect(text).toMatch(/EVERYTHING ELSE\n\nBuilds \(2\)/);
    const alone = writeDigest(digest({ entries: [entry('a2', 1, 'Run failed')], highlights: [{ id: 'a2', why: 'The only failure.' }] }));
    expect(alone.text).not.toContain('EVERYTHING ELSE');
  });

  it('says what Mild did and since when, and counts what is worth a look in the subject', () => {
    const mail = writeDigest(digest({ highlights: [{ id: 'a2', why: 'The only failure.' }] }));
    expect(mail.subject).toBe('Notifications digest for Wed, Nov 18: 3 messages, 1 worth a look');
    expect(mail.text).toContain('3 messages Mild archived since Tue, Nov 17, 7:00 AM');
    expect(mail.preheader).toBe('Worth a look: Run failed');
    expect(mail.html).toContain('Worth a look');
    expect(mail.text).toMatch(/WORTH A LOOK\n\nBuilds: Run failed\n {2}The only failure\./);
  });

  it('says at its foot how many stayed out of the inbox', () => {
    expect(writeDigest(digest()).text).toContain('These 3 stayed out of your inbox.');
    expect(writeDigest(digest()).html).toContain('These 3 stayed out of your inbox.');
    expect(writeDigest(digest({ entries: [entry('a1', 5, 'Run passed')] })).text).toContain('This one stayed out of your inbox.');
  });

  it('names the day it is for, or every day when it waited longer', () => {
    // 15:00 UTC is 7:00 in Los Angeles; the day after a clock change is 25 hours long.
    const fallBack = Date.UTC(2026, 10, 2, 15);
    expect(writeDigest(digest({ since: fallBack - 25 * HOUR, until: fallBack })).subject).toMatch(/^Notifications digest for Mon, Nov 2:/);
    expect(writeDigest(digest({ since: Date.UTC(2026, 9, 30, 14) })).subject).toMatch(/^Notifications digest for Oct 30\u2009–\u2009Nov 18:/);
  });

  it('drops a highlight for a message that is not in the digest', () => {
    const mail = writeDigest(digest({ highlights: [{ id: 'elsewhere', why: 'Not here.' }] }));
    expect(mail.subject).toBe('Notifications digest for Wed, Nov 18: 3 messages');
    expect(mail.html).not.toContain('Worth a look');
    expect(mail.text).not.toContain('Not here.');
  });

  it('writes what came from mail as text, never as markup', () => {
    const hostile = entry('x1', 1, '<img src=x onerror=alert(1)> "quoted"', { name: '<b>Boss</b>', address: 'boss@example.com' });
    const { html } = writeDigest(digest({ entries: [hostile], highlights: [{ id: 'x1', why: '<a href="https://evil.example.com">act now</a>' }] }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>Boss');
    expect(html).not.toContain('href="https://evil');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot;');
  });

  it('links each message in its own mailbox', () => {
    const other = { ...entry('b1', 2, 'From the other mailbox'), mailbox: 'work@example.com' };
    expect(writeDigest(digest({ entries: [other] })).text).toContain('https://mail.google.com/mail/u/work%40example.com/#all/b1');
  });

  it('dates each message instead of timing it when the digest waited longer than a day', () => {
    expect(writeDigest(digest({ entries: [entry('c1', 20, 'Yesterday')] })).text).toContain('  11:00 AM  Yesterday');
    expect(writeDigest(digest({ since: until - 72 * HOUR, entries: [entry('c1', 50, 'Days ago')] })).text).toContain('  Nov 16  Days ago');
  });

  it('lists the newest and links to the label for the rest', () => {
    const many = Array.from({ length: LISTED + 12 }, (_, i) => entry(`m${i}`, i / 10, `Run ${i}`));
    const { text, subject } = writeDigest(digest({ entries: many }));
    expect(subject).toBe(`Notifications digest for Wed, Nov 18: ${LISTED + 12} messages`);
    expect(text).toContain('Run 0\n');
    expect(text).not.toContain(`Run ${LISTED}\n`);
    expect(text).toContain('12 more in Gmail');
    expect(text).toContain('https://mail.google.com/mail/u/me%40example.org/#label/mild%2Fnotifications');
  });

  it('links back to Mild only when it knows its address', () => {
    const { html } = writeDigest(digest());
    expect(html).not.toContain('See them in Mild');
    expect(html).not.toContain('Change or stop this digest');
    const linked = writeDigest(digest({ dashboard: 'https://sift.example.com' }));
    expect(linked.html).toContain('<a href="https://sift.example.com" style');
    expect(linked.text).toContain('See them in Mild: https://sift.example.com/activity?label=notifications');
    expect(linked.text).toContain('Change or stop this digest: https://sift.example.com/labels');
  });
});

describe('toRfc822', () => {
  it('carries both parts and a subject in any script', () => {
    const mail = writeDigest(digest({ entries: [entry('d1', 1, 'Résumé — 日本語')], label: { id: 'recus', name: 'Reçus', gmailLabel: 'mild/recus' } }));
    const raw = toRfc822(mail, { from: 'me@example.org', to: 'me@example.org', date: until, messageId: '<digest-1@sift.invalid>' });
    expect(raw).toContain('From: Mild <me@example.org>\r\n');
    expect(raw).toContain('Message-ID: <digest-1@sift.invalid>\r\n');
    const subject = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(raw)?.[1] ?? '';
    expect(new TextDecoder().decode(Uint8Array.from(atob(subject), (c) => c.charCodeAt(0)))).toBe('Reçus digest for Wed, Nov 18: 1 message');
    const [text, html] = decode(raw);
    expect(text).toEqual({ type: 'text/plain', body: mail.text });
    expect(html).toEqual({ type: 'text/html', body: mail.html });
    expect(raw.split('\r\n').every((line) => line.length <= 998)).toBe(true);
  });
});
