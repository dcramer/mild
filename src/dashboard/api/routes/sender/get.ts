import { z } from 'zod';
import { senderPage } from '../../../queries/senders.ts';
import { SenderPage } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';
import { UNKNOWN, lower } from '../../shared/senders.ts';

export default read({
  path: '/api/sender',
  query: z.object({ address: lower, name: z.string().max(200).optional() }),
  reply: SenderPage,
  run: async ({ db, now }, scope, { address, name }) => {
    const page = await senderPage(db, scope, { address }, now(), name);
    return page ? ok(page) : missing(UNKNOWN);
  },
});
