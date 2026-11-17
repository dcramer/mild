import { type Facts, factLine } from './facts.ts';
import { isSharedDomain } from './standing.ts';
import type { Label, MessageFacts } from './types.ts';

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

export const MAX_SHOTS = 6;
/** From the sender being judged. More would crowd out the owner's other labels, leaving nothing to compare against. */
const MAX_SENDER_SHOTS = 2;
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

/**
 * Choose which labelled examples go in the prompt for `facts`: up to `MAX_SENDER_SHOTS` from the same
 * sender, then the same domain (unless anyone can get an address there), then the newest example of each
 * label from anyone else, newest first within each. Never the message itself, and never an example whose
 * label no longer exists. Stops at `MAX_SHOTS` or the token budget.
 */
export function pickShots(candidates: readonly Shot[], facts: Pick<MessageFacts, 'messageId' | 'from'>, labels: readonly Label[]): Shot[] {
  const known = new Set(labels.map((l) => l.id));
  const usable = candidates.filter((c) => c.messageId !== facts.messageId && known.has(c.labelId)).toSorted((a, b) => b.markedAt - a.markedAt);
  const fromSender = (c: Shot) => c.fromAddress === facts.from.address;
  const others = usable.filter((c) => !fromSender(c));
  const perLabel = new Map<string, Shot>();
  for (const shot of others) if (!perLabel.has(shot.labelId)) perLabel.set(shot.labelId, shot);
  const ranked = [
    ...usable.filter(fromSender).slice(0, MAX_SENDER_SHOTS),
    ...(isSharedDomain(facts.from.domain) ? [] : others.filter((c) => c.fromDomain === facts.from.domain)),
    ...perLabel.values(),
  ];

  const picked = new Map<string, Shot>();
  let budget = SHOT_TOKEN_BUDGET;
  for (const shot of ranked) {
    if (picked.size >= MAX_SHOTS) break;
    if (picked.has(shot.messageId) || tokens(shot) > budget) continue;
    picked.set(shot.messageId, shot);
    budget -= tokens(shot);
  }
  return [...picked.values()];
}
