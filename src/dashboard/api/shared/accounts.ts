import { z } from 'zod';
import type { Person } from '../../../store/people.ts';
import { type Context, text } from '../route.ts';

/** Typed by the person to confirm, as the page asks: the address of the mailbox, or for the whole account one of theirs. */
export const confirmed = z.strictObject({ address: text(320) });

/** Revoke each mailbox's access at Google first; one that cannot be revoked is said, and removed anyway. */
export async function revoke({ db, controls }: Context, mailboxes: readonly string[]): Promise<string[]> {
  if (!controls) throw new Error('This dashboard cannot reach Google to revoke access.');
  const failed: string[] = [];
  for (const email of mailboxes) if (!(await controls.revokeGmail(db, email))) failed.push(email);
  return failed;
}

export const someone = (ctx: Context): Person => {
  if (!ctx.person) throw new Error('Sign in to use the dashboard.');
  return ctx.person;
};
