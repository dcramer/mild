import { z } from 'zod';
import { senderPage } from '../../../queries/senders.ts';
import { SenderPage } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';
import { isSharedDomain } from '../../../../triage/standing.ts';
import { SHARED, UNKNOWN, everyMailbox, lower } from '../../shared/senders.ts';

export default read({
  path: '/api/domain',
  query: z.object({ domain: lower }),
  reply: SenderPage,
  run: async (ctx, scope, { domain }) => {
    const page = await senderPage(ctx.db, scope, everyMailbox(ctx, scope), { domain }, ctx.now());
    return page ? ok(page) : missing(isSharedDomain(domain) ? SHARED : UNKNOWN);
  },
});
