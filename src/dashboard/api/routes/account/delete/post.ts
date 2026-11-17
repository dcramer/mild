import { type z } from 'zod';
import type { Person } from '../../../../../store/people.ts';
import { Removed } from '../../../../types.ts';
import { type Context, write } from '../../../route.ts';
import { confirmed, revoke, someone } from '../../../shared/accounts.ts';
import { Refusal } from '../../../../../refusal.ts';

async function deleteAccount(ctx: Context, person: Person): Promise<z.input<typeof Removed>> {
  const notRevoked = await revoke(ctx, person.accounts);
  await person.remove();
  return { notRevoked, signedOut: true };
}

export default write({
  path: '/api/account/delete',
  body: confirmed,
  reply: Removed,
  touches: () => 'self',
  run: async (ctx, { address }) => {
    const person = someone(ctx);
    if (!person.accounts.includes(address)) throw new Refusal('Type the address of one of your mailboxes to confirm.');
    return await deleteAccount(ctx, person);
  },
  endsSession: (reply) => reply.signedOut,
});
