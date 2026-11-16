import type { ContentFacts } from '../triage/facts.ts';
import { parseAddress } from '../triage/features.ts';
import { htmlFacts } from '../triage/html.ts';

/** The shape of a Gmail message payload that body extraction needs. */
interface BodyPart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null } | null;
  parts?: BodyPart[] | null;
}

/** Long enough to judge what a message is; short enough to keep a classification cheap. */
export const MAX_BODY_CHARS = 4000;

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

/** The readable text of a message: the plain part if there is one, otherwise the HTML with markup removed. Truncated. */
export function extractText(payload: BodyPart | null | undefined): string {
  if (!payload) return '';
  const plain = find(payload, 'text/plain');
  const html = plain === null ? find(payload, 'text/html') : null;
  const text = plain ?? (html === null ? '' : htmlToText(html));
  const tidy = text
    .replace(/\r/g, '')
    .replace(/[ \t ​-‍﻿]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return tidy.length > MAX_BODY_CHARS ? `${tidy.slice(0, MAX_BODY_CHARS)}\n[truncated]` : tidy;
}

/** A message's HTML part, decoded, to be shown and then forgotten. Null when it has none. */
export const findHtml = (payload: BodyPart | null | undefined): string | null => (payload ? find(payload, 'text/html') : null);

const header = (part: BodyPart, name: string) => part.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? '';

function hasAttachment(part: BodyPart): boolean {
  if (part.filename && !/^\s*inline/i.test(header(part, 'content-disposition'))) return true;
  return (part.parts ?? []).some(hasAttachment);
}

/** What sift takes from a whole message: its readable text, and facts about the rest. The HTML itself is not kept. */
export interface MessageContent {
  text: string;
  facts: ContentFacts;
}

export function readContent(payload: BodyPart | null | undefined): MessageContent {
  const html = payload ? find(payload, 'text/html') : null;
  const sender = payload ? parseAddress(header(payload, 'from')) : null;
  return {
    text: extractText(payload),
    facts: { hasAttachments: payload ? hasAttachment(payload) : false, ...(html !== null && sender ? htmlFacts(html, sender.domain) : {}) },
  };
}
