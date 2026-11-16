import { z } from 'zod';
import { senderPage } from '../../../queries/senders.ts';
import { SenderPage } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';
import { SHARED, lower } from '../../shared/senders.ts';

export default read({
  path: '/api/domain',
  query: z.object({ account: z.string().default(''), domain: lower }),
  reply: SenderPage,
  run: async ({ db, now }, scope, { account, domain }) => {
    const page = await senderPage(db, scope, account, { domain }, now());
    return page ? ok(page) : missing(SHARED);
  },
});
