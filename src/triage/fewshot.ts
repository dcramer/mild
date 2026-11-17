import { type Facts, factLine } from './facts.ts';
import { isSharedDomain } from './standing.ts';
import type { Address, Label, MessageFacts } from './types.ts';

/** A message the owner labelled, cut down to what the model is shown of it. Everything but `labelId` and `facts` is untrusted. */
export interface Shot {
  messageId: string;
  fromAddress: string;
  fromDomain: string;
  fromName?: string;
  subject: string;
  /** The start of the message text. */
  excerpt: string;
  facts: Facts;
  /** The owner's answer. */
  labelId: string;
  /** When the owner answered, epoch milliseconds. */
  markedAt: number;
}

/** What one example looks like before its text is read: only the ones picked are. */
export type Candidate = Omit<Shot, 'excerpt'>;

export const MAX_SHOTS = 6;
/** From the sender being judged. More would crowd out the owner's other labels, leaving nothing to compare against. */
const MAX_SENDER_SHOTS = 2;
/** Taken from each way of finding mail like a message (same name, same kind of subject, same sender, same domain). */
export const PER_LOOKUP = 2;
export const MAX_EXCERPT_CHARS = 300;
/** For every example together, at roughly four characters a token. Keeps the examples a small part of the call. */
export const SHOT_TOKEN_BUDGET = 1200;

const tokens = (shot: Shot) =>
  Math.ceil((shot.fromAddress.length + (shot.fromName?.length ?? 0) + shot.subject.length + shot.excerpt.length + factLine(shot.facts).length + 70) / 4);

/** A line that opens many newsletters and says nothing about them: a link to the web copy of the email. */
const WEB_COPY =
  /^(?:(?:view|read|open|see) (?:this |the )?(?:e-?mail |message |newsletter )?(?:in (?:your |a )?(?:web )?browser|online|as a web ?page)|(?:having )?trouble (?:viewing|reading|seeing)|(?:can(?:'|’)?t|cannot) see (?:this|the|images)|email not displaying|web version|click here to view)\b/i;
// Characters newsletters repeat after their preview text so that the mail client's preview shows nothing else.
const PADDING = /\u034f|[\u00ad\u200b-\u200d\u2060\ufeff]/g;

/** The start of a message's text on one line, from its first line that is not a link to its web copy. */
export function excerptOf(body: string): string {
  const lines = body.replace(PADDING, '').split('\n');
  const start = lines.findIndex((line) => line.trim() !== '' && !WEB_COPY.test(line.trim()));
  return lines
    .slice(start === -1 ? lines.length : start)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXCERPT_CHARS);
}

/** A sender's display name as one key, beside the domain (or, where anyone can get an address, the address) whose DMARC says who used it. */
export function nameKey(from: Pick<Address, 'address' | 'domain' | 'name'>): string | null {
  const name = from.name?.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return `${isSharedDomain(from.domain) ? from.address : from.domain} ${name}`;
}

const REPLY_PREFIX = /^(?:\s*(?:re|fwd?|aw|sv|wg)\s*(?:\[\d+\])?\s*:)+/i;
/** Fewer words than this match mail of every kind ("Hello", "Question"). */
const MIN_PATTERN_WORDS = 2;

/**
 * A subject with what changes between mail of one kind taken out: any word with a digit in it (an order
 * number, a date, an amount) is `#`, and "Re:" and "Fwd:" go. Null when too little is left to say what kind it is.
 */
export function subjectPattern(subject: string): string | null {
  const words = subject
    .replace(REPLY_PREFIX, '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (/\d/.test(word) ? '#' : word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')))
    .filter(Boolean);
  return words.filter((w) => w !== '#').length >= MIN_PATTERN_WORDS ? words.join(' ') : null;
}

/**
 * Order the labelled examples that might go in the prompt for `facts`, best first, without repeats:
 * mail under the same sender name, then with the same kind of subject from anyone, then the sender's
 * newest, then their domain's (unless anyone can get an address there), then the newest of each label
 * from anyone else. At most `MAX_SENDER_SHOTS` from the sender's own address, so they go to the mail
 * most like this one. Never the message itself, and never an example whose label no longer exists.
 */
export function pickShots<C extends Candidate>(
  candidates: readonly C[],
  facts: Pick<MessageFacts, 'messageId' | 'from' | 'subject'>,
  labels: readonly Label[],
): C[] {
  const known = new Set(labels.map((l) => l.id));
  const usable = candidates.filter((c) => c.messageId !== facts.messageId && known.has(c.labelId)).toSorted((a, b) => b.markedAt - a.markedAt);
  const fromSender = (c: C) => c.fromAddress === facts.from.address;
  const name = nameKey(facts.from);
  const pattern = subjectPattern(facts.subject);
  const sameName = (c: C) => name !== null && nameKey({ address: c.fromAddress, domain: c.fromDomain, name: c.fromName }) === name;
  const sameSubject = (c: C) => pattern !== null && subjectPattern(c.subject) === pattern;
  const others = usable.filter((c) => !fromSender(c));
  const perLabel = new Map<string, C>();
  for (const shot of others) if (!perLabel.has(shot.labelId)) perLabel.set(shot.labelId, shot);
  const ranked = [
    ...usable.filter(sameName).slice(0, PER_LOOKUP),
    ...usable.filter(sameSubject).slice(0, PER_LOOKUP),
    ...usable.filter(fromSender).slice(0, PER_LOOKUP),
    ...(isSharedDomain(facts.from.domain) ? [] : others.filter((c) => c.fromDomain === facts.from.domain).slice(0, PER_LOOKUP)),
    ...perLabel.values(),
  ];

  const picked = new Map<string, C>();
  let fromThem = 0;
  for (const shot of ranked) {
    if (picked.size >= MAX_SHOTS) break;
    if (picked.has(shot.messageId) || (fromSender(shot) && fromThem >= MAX_SENDER_SHOTS)) continue;
    picked.set(shot.messageId, shot);
    if (fromSender(shot)) fromThem++;
  }
  return [...picked.values()];
}

/** The examples in order until the token budget is spent, skipping any too long for what is left. */
export function withinBudget(shots: readonly Shot[]): Shot[] {
  let budget = SHOT_TOKEN_BUDGET;
  return shots.filter((shot) => {
    if (tokens(shot) > budget) return false;
    budget -= tokens(shot);
    return true;
  });
}
