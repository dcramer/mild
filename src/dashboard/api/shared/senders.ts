import { z } from 'zod';
import { type Scope, scopeFor } from '../../scope.ts';
import type { Context } from '../route.ts';

export const SHARED = 'Anyone can get an address at that domain, so it has no standing of its own.';
export const UNKNOWN = 'No mail from them, and no rule about them.';

export const lower = z
  .string()
  .default('')
  .transform((value) => value.toLowerCase());

/** Every mailbox of whoever asked, past the one a read is narrowed to: only to say whether a sender is known at all. */
export const everyMailbox = ({ person }: Context, scope: Scope): Scope => (person ? scopeFor(person.accounts, person.owner) : scope);
