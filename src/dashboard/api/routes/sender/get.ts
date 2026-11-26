import { z } from 'zod';
import { senderPage } from '../../../queries/senders.ts';
import { SenderPage } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';
import { UNKNOWN, everyMailbox, lower } from '../../shared/senders.ts';

export default read({
  path: '/api/sender',
  query: z.object({ address: lower, name: z.string().max(200).optional() }),
  reply: SenderPage,
  run: async (ctx, scope, { address, name }) => {
    const page = await senderPage(ctx.db, scope, everyMailbox(ctx, scope), { address }, ctx.now(), name);
    return page ? ok(page) : missing(UNKNOWN);
  },
});
