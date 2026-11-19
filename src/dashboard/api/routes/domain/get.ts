import { z } from 'zod';
import { senderPage } from '../../../queries/senders.ts';
import { SenderPage } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';
import { isSharedDomain } from '../../../../triage/standing.ts';
import { SHARED, UNKNOWN, lower } from '../../shared/senders.ts';

export default read({
  path: '/api/domain',
  query: z.object({ domain: lower }),
  reply: SenderPage,
  run: async ({ db, now }, scope, { domain }) => {
    const page = await senderPage(db, scope, { domain }, now());
    return page ? ok(page) : missing(isSharedDomain(domain) ? SHARED : UNKNOWN);
  },
});
