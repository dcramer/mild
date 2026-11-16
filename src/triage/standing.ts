import type { Disposition } from './types.ts';

/**
 * How far a sender (or a whole domain) is trusted. Only the owner's own rule says so: `trusted` is a rule
 * that keeps their mail, `unwanted` and `blocked` rules that hide it. `known` and `new` are everyone the
 * owner has not ruled on. Having written to someone makes them known, not trusted: it makes wanting their
 * mail more likely and proves nothing, and never having written says nothing at all.
 */
export type Standing = 'trusted' | 'known' | 'new' | 'unwanted' | 'blocked';

/** Messages before an unruled sender counts as known. */
const KNOWN_AFTER = 5;

interface StandingInput {
  /** Whether the owner has written to them. Null if that is not known. */
  userHasWritten: boolean | null;
  /** What the owner's own always-rule for exactly this sender or domain does, if there is one. */
  ruled: Exclude<Disposition, 'review'> | null;
  messages: number;
  /** Share of their mail that got their commonest label, 0 to 1. Null with too little mail to say. */
  consistency: number | null;
}

/** A rule the owner made speaks first; after that it is only a matter of how much is known. */
export function standingOf(input: StandingInput): { standing: Standing; why: string } {
  if (input.ruled === 'spam') return { standing: 'blocked', why: 'a rule marks their mail as spam' };
  if (input.ruled === 'archive') return { standing: 'unwanted', why: 'a rule archives their mail' };
  if (input.ruled === 'keep') return { standing: 'trusted', why: 'a rule keeps their mail' };
  if (input.userHasWritten === true) return { standing: 'known', why: 'you have written to them' };
  if (input.messages >= KNOWN_AFTER && input.consistency !== null && input.consistency >= 0.8)
    return { standing: 'known', why: 'their mail is consistently one kind' };
  if (input.messages >= KNOWN_AFTER) return { standing: 'known', why: 'they send more than one kind of mail' };
  return { standing: 'new', why: input.messages <= 1 ? 'first message from them' : 'only a few messages so far' };
}

const SHARED = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'fastmail.com',
  'hey.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'qq.com',
  '163.com',
]);

/** A domain anyone can get an address at. Its senders have nothing in common, so it has no standing of its own. */
export const isSharedDomain = (domain: string) => SHARED.has(domain.toLowerCase());
