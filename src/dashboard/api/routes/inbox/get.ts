import { z } from 'zod';
import { InboxEstimate, InboxReach } from '../../../types.ts';
import { ok, read } from '../../route.ts';
import { Refusal } from '../../../../refusal.ts';

export default read({
  path: '/api/inbox',
  query: z.object({ reach: InboxReach }),
  reply: InboxEstimate,
  run: async ({ db, controls }, scope, { reach }) => {
    if (!controls) throw new Refusal('This dashboard cannot read Gmail.');
    return ok(await controls.inboxEstimate(db, scope.accounts, reach));
  },
});
