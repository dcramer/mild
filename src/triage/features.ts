import type { Address, MessageFacts } from './types.ts';

/** Header-derived signals that a message is bulk or automated mail. */
interface BulkSignals {
  /** The identifier inside the angle brackets of `List-Id`, lowercased. */
  listId: string | null;
  hasListUnsubscribe: boolean;
  /** RFC 8058: an https `List-Unsubscribe` target plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. */
  oneClickUnsubscribeUrl: string | null;
  precedenceBulk: boolean;
  autoSubmitted: boolean;
}

export function bulkSignals(headers: Record<string, string>): BulkSignals {
  const listUnsubscribe = headers['list-unsubscribe'] ?? '';
  const post = headers['list-unsubscribe-post'] ?? '';
  const httpsTarget = /<(https:\/\/[^>\s]+)>/i.exec(listUnsubscribe)?.[1] ?? null;
  const precedence = (headers['precedence'] ?? '').trim().toLowerCase();
  const autoSubmitted = (headers['auto-submitted'] ?? '').trim().toLowerCase();

  return {
    listId: parseListId(headers['list-id']),
    hasListUnsubscribe: listUnsubscribe.trim() !== '',
    oneClickUnsubscribeUrl: /list-unsubscribe=one-click/i.test(post) ? httpsTarget : null,
    precedenceBulk: precedence === 'bulk' || precedence === 'list' || precedence === 'junk',
    autoSubmitted: autoSubmitted !== '' && autoSubmitted !== 'no',
  };
}

/** The authserv-id Gmail writes its `Authentication-Results` under. */
const GMAIL = 'mx.google.com';

/**
 * The `Authentication-Results` header Gmail wrote, or '' when the topmost one is anyone else's. A sender
 * can put the header in their own message with any result in it; only the receiver's own is evidence.
 * RFC 8601: the authserv-id comes first, after any comment, and may be followed by a version number.
 */
export function receivedResults(headers: Record<string, string>): string {
  const results = headers['authentication-results'] ?? '';
  const authserv = /^\s*(?:\([^)]*\)\s*)*"?([^\s;"()]+)"?(?:\s+\d+)?\s*(?:\([^)]*\)\s*)*;/.exec(results)?.[1];
  return authserv?.toLowerCase() === GMAIL ? results : '';
}

/**
 * Whether the message passed DMARC, as Gmail recorded it: the sender address is who it says it is.
 * Without this the From address proves nothing, and acting on it (blocking the sender, following their
 * unsubscribe link) could be turned against a sender who was only impersonated.
 */
export function passedDmarc(headers: Record<string, string>): boolean {
  return /\bdmarc=pass\b/i.test(receivedResults(headers));
}

export function parseListId(raw: string | undefined): string | null {
  if (!raw) return null;
  const bracketed = /<([^>]+)>/.exec(raw)?.[1] ?? raw;
  const id = bracketed.trim().toLowerCase();
  return id === '' ? null : id;
}

/** Parse a single `From`-style header value. Returns null when there is no usable address. */
export function parseAddress(raw: string): Address | null {
  const bracketed = /^(.*)<([^<>]+)>\s*$/.exec(raw.trim());
  const address = (bracketed?.[2] ?? raw).trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1 || /\s/.test(address)) return null;
  const name = bracketed?.[1]?.trim().replace(/^"(.*)"$/, '$1');
  return { address, domain: address.slice(at + 1), ...(name ? { name } : {}) };
}

/** Parse a `To`/`Cc`-style header holding any number of addresses. Unparseable entries are dropped. */
export function parseAddressList(raw: string | undefined): Address[] {
  if (!raw) return [];
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angle = false;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') angle = true;
    else if (!quoted && ch === '>') angle = false;
    if (ch === ',' && !quoted && !angle) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map(parseAddress).filter((a) => a !== null);
}

/** Who sent a message, to whom, and about what, as its headers (names lowercased) say. Null without a usable From. */
export function envelopeOf(headers: Record<string, string>): Pick<MessageFacts, 'from' | 'to' | 'cc' | 'subject'> | null {
  const from = parseAddress(headers['from'] ?? '');
  if (!from) return null;
  return { from, to: parseAddressList(headers['to']), cc: parseAddressList(headers['cc']), subject: headers['subject'] ?? '' };
}
