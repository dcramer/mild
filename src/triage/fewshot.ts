import type { Label, MessageFacts } from './types.ts';

/** A message the owner labelled, cut down to what the model is shown of it. Everything but `labelId` is untrusted. */
export interface Shot {
  messageId: string;
  fromAddress: string;
  fromDomain: string;
  fromName?: string;
  subject: string;
  /** The start of the message text. */
  excerpt: string;
  /** The owner's answer. */
  labelId: string;
  /** When the owner answered, epoch milliseconds. */
  markedAt: number;
}

export const MAX_SHOTS = 6;
export const MAX_EXCERPT_CHARS = 300;
/** For every example together, at roughly four characters a token. Keeps the examples a small part of the call. */
export const SHOT_TOKEN_BUDGET = 1200;

const tokens = (shot: Shot) => Math.ceil((shot.fromAddress.length + (shot.fromName?.length ?? 0) + shot.subject.length + shot.excerpt.length + 60) / 4);

/** The start of a message's text on one line. */
export function excerptOf(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, MAX_EXCERPT_CHARS);
}

/**
 * Choose which labelled examples go in the prompt for `facts`: the same sender first, then the same
 * domain, then the newest example of each label, newest first within each. Never the message itself,
 * and never an example whose label no longer exists. Stops at `MAX_SHOTS` or the token budget.
 */
export function pickShots(candidates: readonly Shot[], facts: Pick<MessageFacts, 'messageId' | 'from'>, labels: readonly Label[]): Shot[] {
  const known = new Set(labels.map((l) => l.id));
  const usable = candidates.filter((c) => c.messageId !== facts.messageId && known.has(c.labelId)).toSorted((a, b) => b.markedAt - a.markedAt);
  const perLabel = new Map<string, Shot>();
  for (const shot of usable) if (!perLabel.has(shot.labelId)) perLabel.set(shot.labelId, shot);
  const ranked = [
    ...usable.filter((c) => c.fromAddress === facts.from.address),
    ...usable.filter((c) => c.fromAddress !== facts.from.address && c.fromDomain === facts.from.domain),
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
