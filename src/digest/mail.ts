/** One message in a digest, as its headers say. A digest never holds a message's body. */
export interface DigestEntry {
  /** The mailbox it is in: its Gmail link opens there. */
  mailbox: string;
  /** Gmail's id. */
  id: string;
  from: { name?: string; address: string };
  subject: string;
  receivedAt: number;
}

/** A message the person's model thinks they should see, and why, in a line. */
interface Highlight {
  id: string;
  why: string;
}

/** One label's mail that Sift took out of the inbox since the last digest. */
export interface Digest {
  label: { name: string; gmailLabel: string };
  /** The mailbox the digest is put in. */
  mailbox: string;
  since: number;
  /** When the digest was due: the day it is for. */
  until: number;
  entries: DigestEntry[];
  highlights: Highlight[];
  /** The person's, so times read as their clock does. */
  timeZone: string;
  /** Where the person changes the digest. */
  dashboard?: string;
}

export interface DigestMail {
  subject: string;
  /** What Gmail shows after the subject in the list. */
  preheader: string;
  html: string;
  text: string;
}

/** Past this, the rest are one link to the label in Gmail: a digest is read on a phone. */
export const LISTED = 150;

/** A day across a clock change is 25 hours. */
const ONE_DAY = 25 * 3_600_000;

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const INK = '#111110';
const MUTED = '#6b6a63';
const RULE = '#e7e6e1';
const MARK = '#ffe033';

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

const gmail = (mailbox: string, fragment: string) => `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#${fragment}`;

/** Gmail opens a message by its id under any view; the view is where Back goes. */
const messageLink = (entry: DigestEntry) => gmail(entry.mailbox, `all/${encodeURIComponent(entry.id)}`);

const labelLink = (digest: Digest) => gmail(digest.mailbox, `label/${encodeURIComponent(digest.label.gmailLabel).replace(/%20/g, '+')}`);

const sender = (entry: DigestEntry) => entry.from.name?.trim() || entry.from.address;
const subjectOf = (entry: DigestEntry) => entry.subject.trim() || '(no subject)';

export function writeDigest(digest: Digest): DigestMail {
  const zone = { timeZone: digest.timeZone };
  const clock = new Intl.DateTimeFormat('en-US', { ...zone, hour: 'numeric', minute: '2-digit' });
  const dayName = new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'long', month: 'long', day: 'numeric' });
  const dayKey = new Intl.DateTimeFormat('en-CA', { ...zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const moment = new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const date = new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'short', month: 'short', day: 'numeric' });
  const dates = new Intl.DateTimeFormat('en-US', { ...zone, month: 'short', day: 'numeric' });
  // A phone would otherwise break "7:00" from its "AM".
  const keepTogether = (time: string) => time.replace(/ (AM|PM)$/, '\u00a0$1');

  const entries = digest.entries.toSorted((a, b) => b.receivedAt - a.receivedAt);
  const listed = entries.slice(0, LISTED);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const highlights = digest.highlights.flatMap((h) => {
    const entry = byId.get(h.id);
    return entry ? [{ entry, why: h.why.trim() }] : [];
  });
  const days = new Set(listed.map((e) => dayKey.format(e.receivedAt)));
  const spansDays = days.size > 1;

  // A window longer than a day (the first digest, or days Sift was off) names every day it holds.
  const span = digest.until - digest.since <= ONE_DAY ? date.format(digest.until) : dates.formatRange(digest.since, digest.until);
  const subject = `${digest.label.name} digest for ${span}: ${plural(entries.length, 'message')}${highlights.length > 0 ? `, ${highlights.length} worth a look` : ''}`;
  const summary = `${plural(entries.length, 'message')} Sift archived since ${keepTogether(moment.format(digest.since))}`;
  const senders = [...new Set(entries.map(sender))];
  const preheader =
    highlights.length > 0
      ? `Worth a look: ${highlights.map((h) => subjectOf(h.entry)).join(' · ')}`
      : senders.length <= 3
        ? senders.join(', ')
        : `${senders.slice(0, 3).join(', ')} and ${plural(senders.length - 3, 'other')}`;
  const more = entries.length - listed.length;

  const html = page(subject, preheader, [
    row(`<td style="font:700 13px/1 ${FONT};color:${MUTED};letter-spacing:-0.01em;padding:0 0 20px;">sift</td>`),
    row(`<td style="font:700 28px/1.15 ${FONT};color:${INK};letter-spacing:-0.03em;">${escape(digest.label.name)}</td>`),
    row(`<td style="font:400 15px/1.5 ${FONT};color:${MUTED};padding:6px 0 28px;">${escape(summary)}</td>`),
    ...(highlights.length > 0
      ? [
          row(
            `<td style="padding:0 0 4px;"><span style="background:${MARK};color:${INK};font:700 12px/1 ${FONT};letter-spacing:0.06em;text-transform:uppercase;padding:4px 6px 3px;">Worth a look</span></td>`,
          ),
          ...highlights.map(({ entry, why }) =>
            row(
              `<td style="padding:12px 0;border-bottom:1px solid ${RULE};">${item(messageLink(entry), entry)}${
                why ? `<div style="font:400 14px/1.45 ${FONT};color:${MUTED};padding:3px 0 0;">${escape(why)}</div>` : ''
              }</td>`,
            ),
          ),
          row(`<td style="padding:16px 0 0;"></td>`),
        ]
      : []),
    row(
      `<td style="font:700 12px/1 ${FONT};color:${MUTED};letter-spacing:0.06em;text-transform:uppercase;padding:16px 0 ${spansDays ? '0' : '4px'};">Everything</td>`,
    ),
    ...listed.flatMap((entry, i) => {
      const day = dayKey.format(entry.receivedAt);
      const opens = spansDays && (i === 0 || dayKey.format(listed[i - 1]!.receivedAt) !== day);
      return [
        ...(opens ? [row(`<td style="font:700 15px/1.3 ${FONT};color:${INK};padding:20px 0 2px;">${escape(dayName.format(entry.receivedAt))}</td>`)] : []),
        row(
          `<td style="border-bottom:1px solid ${RULE};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
            `<td width="76" valign="top" style="font:400 14px/1.5 ${FONT};color:${MUTED};padding:9px 0;white-space:nowrap;font-variant-numeric:tabular-nums;">${escape(clock.format(entry.receivedAt))}</td>` +
            `<td valign="top" style="padding:9px 0;">${item(messageLink(entry), entry)}</td>` +
            `</tr></table></td>`,
        ),
      ];
    }),
    ...(more > 0
      ? [
          row(
            `<td style="font:400 15px/1.5 ${FONT};padding:14px 0 0;"><a href="${escape(labelLink(digest))}" style="color:${INK};">${escape(`${more.toLocaleString('en-US')} more in Gmail`)}</a></td>`,
          ),
        ]
      : []),
    row(
      `<td style="font:400 13px/1.6 ${FONT};color:${MUTED};padding:32px 0 0;">` +
        `<a href="${escape(labelLink(digest))}" style="color:${MUTED};">Open ${escape(digest.label.name)} in Gmail</a>` +
        (digest.dashboard ? ` &nbsp;·&nbsp; <a href="${escape(`${digest.dashboard}/labels`)}" style="color:${MUTED};">Change or stop this digest</a>` : '') +
        `</td>`,
    ),
  ]);

  const text = [
    digest.label.name,
    summary,
    ...(highlights.length > 0
      ? [
          '',
          'WORTH A LOOK',
          ...highlights.flatMap(({ entry, why }) => ['', `${sender(entry)}: ${subjectOf(entry)}`, ...(why ? [`  ${why}`] : []), `  ${messageLink(entry)}`]),
        ]
      : []),
    '',
    'EVERYTHING',
    ...listed.flatMap((entry, i) => {
      const day = dayKey.format(entry.receivedAt);
      const opens = spansDays && (i === 0 || dayKey.format(listed[i - 1]!.receivedAt) !== day);
      return [
        ...(opens ? ['', dayName.format(entry.receivedAt)] : []),
        '',
        `${clock.format(entry.receivedAt)}  ${sender(entry)}`,
        `  ${subjectOf(entry)}`,
        `  ${messageLink(entry)}`,
      ];
    }),
    ...(more > 0 ? ['', `${more.toLocaleString('en-US')} more in Gmail: ${labelLink(digest)}`] : []),
    '',
    `Open in Gmail: ${labelLink(digest)}`,
    ...(digest.dashboard ? [`Change or stop this digest: ${digest.dashboard}/labels`] : []),
    '',
  ].join('\n');

  return { subject, preheader, html, text };
}

const item = (href: string, entry: DigestEntry) =>
  `<a href="${escape(href)}" style="color:${INK};text-decoration:none;display:block;">` +
  `<span style="font:700 15px/1.4 ${FONT};color:${INK};">${escape(sender(entry))}</span><br>` +
  `<span style="font:400 15px/1.45 ${FONT};color:${INK};">${escape(subjectOf(entry))}</span></a>`;

const row = (cell: string) => `<tr>${cell}</tr>`;

function page(title: string, preheader: string, rows: string[]): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head>` +
    `<body style="margin:0;padding:0;">` +
    // Gmail shows the first text after the subject; the spaces keep the body's own words from following it.
    `<div style="display:none;max-height:0;overflow:hidden;">${escape(preheader)}${'&#8199;&#847;'.repeat(60)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:28px 16px 40px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">${rows.join('')}</table>` +
    `</td></tr></table></body></html>`
  );
}

/** The message as Gmail's `messages.insert` takes it: RFC 2822, both parts in base64. */
export function toRfc822(mail: DigestMail, head: { from: string; to: string; date: number; messageId: string }): string {
  // Not a base64 character, so no line of either part can end it.
  const boundary = 'sift-digest-part';
  return [
    `From: Sift <${head.from}>`,
    `To: ${head.to}`,
    `Subject: ${encodedWord(mail.subject)}`,
    `Date: ${new Date(head.date).toUTCString()}`,
    `Message-ID: ${head.messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const base64Lines = (text: string) => base64(text).replace(/.{76}/g, '$&\r\n');

/** A subject holds whatever the mail's subjects held, so it is always encoded (RFC 2047). */
const encodedWord = (text: string) => `=?UTF-8?B?${base64(text)}?=`;
