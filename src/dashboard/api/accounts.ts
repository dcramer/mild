import { z } from 'zod';
import type { Person } from '../../store/people.ts';
import { Removed } from '../types.ts';
import { type Context, type Write, text, write } from './route.ts';

/** Typed by the person to confirm, as the page asks: the address of the mailbox, or for the whole account one of theirs. */
const confirmed = z.strictObject({ address: text(320) });

/** Revoke each mailbox's access at Google first; one that cannot be revoked is said, and removed anyway. */
async function revoke({ db, controls }: Context, mailboxes: readonly string[]): Promise<string[]> {
  if (!controls) throw new Error('This dashboard cannot reach Google to revoke access.');
  const failed: string[] = [];
  for (const email of mailboxes) if (!(await controls.revokeGmail(db, email))) failed.push(email);
  return failed;
}

async function deleteAccount(ctx: Context, person: Person): Promise<z.input<typeof Removed>> {
  const notRevoked = await revoke(ctx, person.accounts);
  await person.remove();
  return { notRevoked, signedOut: true };
}

const someone = (ctx: Context): Person => {
  if (!ctx.person) throw new Error('Sign in to use the dashboard.');
  return ctx.person;
};

export const writes: Write[] = [
  write({
    path: '/api/mailbox/remove',
    body: confirmed,
    reply: Removed,
    touches: (_ctx, { address }) => ({ account: address }),
    // A person's last mailbox is how they sign in, so removing it deletes them.
    run: async (ctx, { address }) => {
      const person = someone(ctx);
      if (person.accounts.length === 1) return await deleteAccount(ctx, person);
      const notRevoked = await revoke(ctx, [address]);
      await person.removeMailbox(address);
      return { notRevoked, signedOut: address === ctx.signedInAs };
    },
    endsSession: (reply) => reply.signedOut,
  }),
  write({
    path: '/api/account/delete',
    body: confirmed,
    reply: Removed,
    touches: () => 'self',
    run: async (ctx, { address }) => {
      const person = someone(ctx);
      if (!person.accounts.includes(address)) throw new Error('Type the address of one of your mailboxes to confirm.');
      return await deleteAccount(ctx, person);
    },
    endsSession: (reply) => reply.signedOut,
  }),
];
