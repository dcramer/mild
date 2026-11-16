import { Removed } from '../../../../types.ts';
import { write } from '../../../route.ts';
import { confirmed, revoke, someone } from '../../../shared/accounts.ts';

export default write({
  path: '/api/mailbox/remove',
  body: confirmed,
  reply: Removed,
  touches: (_ctx, { address }) => ({ account: address }),
  // A person's only mailbox is how they sign in: removing it would be deleting the account, which is its own write.
  run: async (ctx, { address }) => {
    const person = someone(ctx);
    if (person.accounts.length === 1) throw new Error('You cannot delete your only remaining mailbox. Delete your account instead.');
    const notRevoked = await revoke(ctx, [address]);
    await person.removeMailbox(address);
    return { notRevoked, signedOut: address === ctx.signedInAs };
  },
  endsSession: (reply) => reply.signedOut,
});
