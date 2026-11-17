import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { addLabels } from '../../../../../store/labels.ts';
import { accountId, fromOutcome, named, outcome, text, write } from '../../../route.ts';
import { DESCRIPTION } from '../../../shared/labels.ts';

export default write({
  path: '/api/labels/add',
  body: z.strictObject({
    accountId,
    name: text(60),
    description: DESCRIPTION,
    disposition: outcome,
    markRead: z.boolean().optional(),
    unsubscribe: z.boolean().optional(),
  }),
  reply: z.object({ id: z.string() }),
  touches: named,
  run: async ({ db }, { accountId, name, description, disposition, markRead, unsubscribe }) => {
    if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
    const label = { name, description, ...fromOutcome(disposition), ...(markRead ? { markRead } : {}), ...(unsubscribe ? { unsubscribe } : {}) };
    const [added] = await addLabels(db, accountId, [label]);
    return { id: added!.id };
  },
});
