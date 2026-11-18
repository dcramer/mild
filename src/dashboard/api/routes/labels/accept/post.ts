import { z } from 'zod';
import { addLabels, hasOwnLabels } from '../../../../../store/labels.ts';
import { MAX_DRAFTS } from '../../../../../triage/proposal.ts';
import { fromOutcome, outcome, self, text, write } from '../../../route.ts';
import { DESCRIPTION } from '../../../shared/labels.ts';
import { Refusal } from '../../../../../refusal.ts';

/** Make the labels the person kept from a proposal, when they have none yet, all or none. The first pass follows. */
export default write({
  path: '/api/labels/accept',
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
  run: async ({ db, controls }, { labels }) => {
    if (await hasOwnLabels(db)) throw new Refusal('You have labels already. Change them on the Labels screen.');
    const wanted = labels.map(({ disposition, markRead, unsubscribe, ...rest }) => ({
      ...rest,
      ...fromOutcome(disposition),
      ...(markRead ? { markRead } : {}),
      ...(unsubscribe ? { unsubscribe } : {}),
    }));
    const added = await db.transaction(async (tx) => await addLabels(tx, wanted));
    await controls?.checkNow(db);
    return { ids: added.map((l) => l.id) };
  },
});
