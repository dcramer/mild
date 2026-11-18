import { z } from 'zod';
import { addLabels } from '../../../../../store/labels.ts';
import { MAX_DRAFTS } from '../../../../../triage/proposal.ts';
import { fromOutcome, outcome, self, text, write } from '../../../route.ts';
import { DESCRIPTION } from '../../../shared/labels.ts';

/** Add labels of the person's own, by hand or kept from what the model suggested: all or none. */
export default write({
  path: '/api/labels/add',
  body: z.strictObject({
    labels: z
      .array(
        z.strictObject({
          name: text(60),
          description: DESCRIPTION,
          disposition: outcome,
          markRead: z.boolean().optional(),
          unsubscribe: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(MAX_DRAFTS),
  }),
  reply: z.object({ ids: z.array(z.string()) }),
  touches: self,
  run: async ({ db }, { labels }) => {
    const wanted = labels.map(({ disposition, markRead, unsubscribe, ...rest }) => ({
      ...rest,
      ...fromOutcome(disposition),
      ...(markRead ? { markRead } : {}),
      ...(unsubscribe ? { unsubscribe } : {}),
    }));
    const added = await db.transaction(async (tx) => await addLabels(tx, wanted));
    return { ids: added.map((l) => l.id) };
  },
});
