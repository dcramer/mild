import { done, text, write } from '../../../route.ts';
import { someone } from '../../../shared/accounts.ts';
import { z } from 'zod';

export default write({
  path: '/api/mailbox/primary',
  body: z.strictObject({ address: text(320) }),
  reply: done,
  touches: (_ctx, { address }) => ({ account: address }),
  run: async (ctx, { address }) => {
    await someone(ctx).makePrimary(address);
    return { ok: true as const };
  },
});
