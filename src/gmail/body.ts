import type { ContentFacts } from '../triage/facts.ts';
import { parseAddress } from '../triage/features.ts';
import { htmlFacts } from '../triage/html.ts';

/** The shape of a Gmail message payload that body extraction needs. */
interface BodyPart {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null;
  parts?: BodyPart[] | null;
}

/** A file a message carries, as Mild keeps it to list it and to forward it. `gmailId` is what Gmail gives its bytes by. */
export interface Attachment {
  part: string;
  name: string;
  type: string;
  size: number;
  gmailId: string;
}

/** Long enough to judge what a message is; short enough to keep a classification cheap. */
export const MAX_BODY_CHARS = 4000;
/**
 * What Inbox keeps of a message's text, which it shows whole: far past any letter a person writes, while bounding what one
 * row holds and what a pass's batch of 50 holds in memory. HTML is kept as it comes, as for waiting mail.
 */
const MAX_MAIL_CHARS = 200_000;

const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8');

function find(part: BodyPart, mimeType: string): string | null {
  if (part.mimeType === mimeType && part.body?.data) return decode(part.body.data);
  for (const child of part.parts ?? []) {
    const found = find(child, mimeType);
    if (found !== null) return found;
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

const BLOCK = /^(?:div|p|tr|li|ul|ol|table|blockquote|h[1-6])$/i;
const ENTITY: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * A Gmail signature, which Gmail keeps as HTML, as the lines it reads as: a block starts a line, an empty one (`<div><br></div>`)
 * is a blank line, and images, a logo most often, are left out.
 */
export function signatureText(html: string): string {
  const lines: string[] = [];
  let line = '';
  const end = (always: boolean) => {
    if (always || line.trim() !== '') lines.push(line.replace(/\s+/g, ' ').trim());
    line = '';
  };
  for (const [, tag, name = '', text = ''] of html.replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '').matchAll(/(<\/?([a-z][a-z0-9]*)\b[^>]*>)|([^<]+)/gi)) {
    if (tag === undefined) line += text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => entity(code) ?? whole);
    else if (name.toLowerCase() === 'br') end(true);
    else if (BLOCK.test(name)) end(false);
  }
  end(false);
  const first = lines.findIndex((l) => l !== '');
  const last = lines.findLastIndex((l) => l !== '');
  return first === -1 ? '' : lines.slice(first, last + 1).join('\n');
}

function entity(code: string): string | undefined {
  if (!code.startsWith('#')) return ENTITY[code.toLowerCase()];
  const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
  return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : undefined;
}

/** The readable text of a message: the plain part if there is one, otherwise the HTML with markup removed. Truncated. */
export function extractText(payload: BodyPart | null | undefined): string {
  return shortened(readable(payload));
}

/** All of a message's readable text: its plain part, or else its HTML's text. */
function readable(payload: BodyPart | null | undefined): string {
  if (!payload) return '';
  const plain = find(payload, 'text/plain');
  const html = plain === null ? find(payload, 'text/html') : null;
  const text = plain ?? (html === null ? '' : htmlToText(html));
  return text
    .replace(/\r/g, '')
    .replace(/[ \t ​-‍﻿]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most)}\n[truncated]` : text);
const shortened = (text: string) => cut(text, MAX_BODY_CHARS);

const header = (part: BodyPart, name: string) => part.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? '';

/** A file the message carries, not a picture drawn inside its HTML. */
const attached = (part: BodyPart) => Boolean(part.filename) && !/^\s*inline/i.test(header(part, 'content-disposition'));

function hasAttachment(part: BodyPart): boolean {
  return attached(part) || (part.parts ?? []).some(hasAttachment);
}

/** Its files, in the order they are in it. One Gmail gives no id for cannot be fetched, and is left out. */
function attachmentsOf(part: BodyPart | null | undefined): Attachment[] {
  if (!part) return [];
  const id = part.body?.attachmentId;
  const own: Attachment[] =
    attached(part) && id
      ? [{ part: part.partId ?? '', name: part.filename!, type: part.mimeType || 'application/octet-stream', size: part.body?.size ?? 0, gmailId: id }]
      : [];
  return [...own, ...(part.parts ?? []).flatMap(attachmentsOf)];
}

/** What Mild takes from a whole message: its readable text, its HTML part, and facts about the rest. */
export interface MessageContent {
  text: string;
  /** More of the text than `text` holds, up to `MAX_MAIL_CHARS`, for Inbox; absent when `text` is all of it. */
  whole?: string;
  /** The HTML part as the message carries it, uncleaned. Null when it has none. */
  html: string | null;
  /** Absent for content Mild kept before it kept these. */
  attachments?: Attachment[];
  facts: ContentFacts;
}

export function readContent(payload: BodyPart | null | undefined): MessageContent {
  const html = payload ? find(payload, 'text/html') : null;
  const sender = payload ? parseAddress(header(payload, 'from')) : null;
  const whole = readable(payload);
  return {
    text: shortened(whole),
    ...(whole.length > MAX_BODY_CHARS ? { whole: cut(whole, MAX_MAIL_CHARS) } : {}),
    html,
    attachments: attachmentsOf(payload),
    facts: {
      hasAttachments: payload ? hasAttachment(payload) : false,
      words: whole === '' ? 0 : whole.split(/\s+/).length,
      ...(html !== null && sender ? htmlFacts(html, sender.domain) : {}),
    },
  };
}

/** A message's content from all of its text that Inbox holds, as `readContent` gives it. */
export function heldContent(whole: string, html: string | null, facts: ContentFacts): MessageContent {
  return { text: shortened(whole), ...(whole.length > MAX_BODY_CHARS ? { whole } : {}), html, facts };
}
