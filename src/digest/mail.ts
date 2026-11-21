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

/** One label's mail that Mild took out of the inbox since the last digest. */
export interface Digest {
  label: { id: string; name: string; gmailLabel: string };
  /** The mailbox the digest is put in. */
  mailbox: string;
  since: number;
  /** When the digest was due: the day it is for. */
  until: number;
  entries: DigestEntry[];
  highlights: Highlight[];
  /** The person's, so times read as their clock does. */
  timeZone: string;
  /** Mild's dashboard, for links back to it. */
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

/** One line of a sender's mail: messages with the same subject are one line, linked to the newest. */
interface Line {
  newest: DigestEntry;
  count: number;
}

/** A sender's mail in the digest, newest first. */
interface Group {
  from: DigestEntry;
  count: number;
  lines: Line[];
}

/** Each sender's mail, the senders with the most first, then the most recent. `entries` is newest first. */
function bySender(entries: readonly DigestEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    const key = entry.from.address.toLowerCase();
    const group = groups.get(key) ?? { from: entry, count: 0, lines: [] };
    groups.set(key, group);
    group.count++;
    const line = group.lines.find((l) => subjectOf(l.newest) === subjectOf(entry));
    if (line) line.count++;
    else group.lines.push({ newest: entry, count: 1 });
  }
  return [...groups.values()].toSorted((a, b) => b.count - a.count || b.from.receivedAt - a.from.receivedAt);
}

export function writeDigest(digest: Digest): DigestMail {
  const zone = { timeZone: digest.timeZone };
  const moment = new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const date = new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'short', month: 'short', day: 'numeric' });
  const dates = new Intl.DateTimeFormat('en-US', { ...zone, month: 'short', day: 'numeric' });
  // A phone would otherwise break "7:00" from its "AM".
  const keepTogether = (time: string) => time.replace(/ (AM|PM)$/, '\u00a0$1');

  const entries = digest.entries.toSorted((a, b) => b.receivedAt - a.receivedAt);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const highlights = digest.highlights.flatMap((h) => {
    const entry = byId.get(h.id);
    return entry ? [{ entry, why: h.why.trim() }] : [];
  });
  const picked = new Set(highlights.map((h) => h.entry.id));
  const groups = bySender(entries.slice(0, LISTED).filter((e) => !picked.has(e.id)));

  // A window longer than a day (the first digest, or days Mild was off) names every day it holds, and each message its day.
  const oneDay = digest.until - digest.since <= ONE_DAY;
  const span = oneDay ? date.format(digest.until) : dates.formatRange(digest.since, digest.until);
  const when = oneDay ? new Intl.DateTimeFormat('en-US', { ...zone, hour: 'numeric', minute: '2-digit' }) : dates;
  const timeOf = (entry: DigestEntry) => keepTogether(when.format(entry.receivedAt));
  const subject = `${digest.label.name} digest for ${span}: ${plural(entries.length, 'message')}${highlights.length > 0 ? `, ${highlights.length} worth a look` : ''}`;
  const summary = `${plural(entries.length, 'message')} Mild archived since ${keepTogether(moment.format(digest.since))}`;
  const senders = bySender(entries).map((g) => sender(g.from));
  const preheader =
    highlights.length > 0
      ? `Worth a look: ${highlights.map((h) => subjectOf(h.entry)).join(' · ')}`
      : senders.length <= 3
        ? senders.join(', ')
        : `${senders.slice(0, 3).join(', ')} and ${plural(senders.length - 3, 'other')}`;
  const more = Math.max(0, entries.length - LISTED);
  const stayedOut = entries.length === 1 ? 'This one stayed out of your inbox.' : `These ${entries.length.toLocaleString('en-US')} stayed out of your inbox.`;
  const inSift = digest.dashboard && `${digest.dashboard}/activity?${new URLSearchParams({ label: digest.label.id }).toString()}`;
  // Held to the subject's last word, so a phone never leaves the count on a line alone.
  const times = (count: number) => (count > 1 ? `\u00a0×${count}` : '');

  const html = page(subject, preheader, [
    row(
      `<td style="padding:0 0 20px;">${
        digest.dashboard
          ? `<a href="${escape(digest.dashboard)}" style="font:700 13px/1 ${FONT};color:${MUTED};letter-spacing:-0.01em;text-decoration:none;">mild</a>`
          : `<span style="font:700 13px/1 ${FONT};color:${MUTED};letter-spacing:-0.01em;">mild</span>`
      }</td>`,
    ),
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
          ...(groups.length > 0
            ? [row(`<td style="font:700 12px/1 ${FONT};color:${MUTED};letter-spacing:0.06em;text-transform:uppercase;padding:36px 0 0;">Everything else</td>`)]
            : []),
        ]
      : []),
    ...groups.flatMap((group, i) => [
      row(
        `<td style="padding:${i === 0 ? 12 : 28}px 0 6px;border-bottom:1px solid ${RULE};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
          `<td style="font:700 15px/1.3 ${FONT};color:${INK};">${escape(sender(group.from))}</td>` +
          `<td align="right" style="font:400 13px/1.3 ${FONT};color:${MUTED};font-variant-numeric:tabular-nums;">${group.count.toLocaleString('en-US')}</td>` +
          `</tr></table></td>`,
      ),
      ...group.lines.map(({ newest, count }) =>
        row(
          `<td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
            `<td valign="top" style="font:400 15px/1.4 ${FONT};padding:8px 12px 0 0;"><a href="${escape(messageLink(newest))}" style="color:${INK};text-decoration:none;">${escape(subjectOf(newest))}</a>${
              count > 1 ? `<span style="color:${MUTED};font-variant-numeric:tabular-nums;">${times(count)}</span>` : ''
            }</td>` +
            `<td valign="top" align="right" width="72" style="font:400 13px/1.6 ${FONT};color:${MUTED};padding:8px 0 0;white-space:nowrap;font-variant-numeric:tabular-nums;">${escape(timeOf(newest))}</td>` +
            `</tr></table></td>`,
        ),
      ),
    ]),
    ...(more > 0
      ? [
          row(
            `<td style="font:400 15px/1.5 ${FONT};padding:20px 0 0;"><a href="${escape(labelLink(digest))}" style="color:${INK};">${escape(`${more.toLocaleString('en-US')} more in Gmail`)}</a></td>`,
          ),
        ]
      : []),
    row(`<td style="font:400 15px/1.5 ${FONT};color:${INK};padding:36px 0 0;">${escape(stayedOut)}</td>`),
    row(
      `<td style="font:400 13px/1.6 ${FONT};color:${MUTED};padding:16px 0 0;">` +
        [
          ...(inSift ? [`<a href="${escape(inSift)}" style="color:${MUTED};white-space:nowrap;">See them in Mild</a>`] : []),
          `<a href="${escape(labelLink(digest))}" style="color:${MUTED};white-space:nowrap;">Open ${escape(digest.label.name)} in Gmail</a>`,
          ...(digest.dashboard
            ? [`<a href="${escape(`${digest.dashboard}/labels`)}" style="color:${MUTED};white-space:nowrap;">Change or stop this digest</a>`]
            : []),
        ].join(' &nbsp;·&nbsp; ') +
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
          ...(groups.length > 0 ? ['', '', 'EVERYTHING ELSE'] : []),
        ]
      : []),
    ...groups.flatMap((group) => [
      '',
      `${sender(group.from)} (${group.count.toLocaleString('en-US')})`,
      ...group.lines.flatMap(({ newest, count }) => [`  ${when.format(newest.receivedAt)}  ${subjectOf(newest)}${times(count)}`, `  ${messageLink(newest)}`]),
    ]),
    ...(more > 0 ? ['', `${more.toLocaleString('en-US')} more in Gmail: ${labelLink(digest)}`] : []),
    '',
    stayedOut,
    '',
    ...(inSift ? [`See them in Mild: ${inSift}`] : []),
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
    `From: Mild <${head.from}>`,
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
