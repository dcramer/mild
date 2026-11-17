import { z } from 'zod';
import { senderPage } from '../../../queries/senders.ts';
import { SenderPage } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';
import { SHARED, lower } from '../../shared/senders.ts';

export default read({
  path: '/api/sender',
  query: z.object({ account: z.string().default(''), address: lower, name: z.string().max(200).optional() }),
  reply: SenderPage,
  run: async ({ db, now }, scope, { account, address, name }) => {
    const page = await senderPage(db, scope, account, { address }, now(), name);
    return page ? ok(page) : missing(SHARED);
  },
});
