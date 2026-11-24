import { z } from 'zod';
import { addLabels, hasOwnLabels } from '../../../../../store/labels.ts';
import { MAX_DRAFTS } from '../../../../../prompts/proposal.ts';
import { rememberTimeZone } from '../../../../../store/preferences.ts';
import { fromOutcome, outcome, self, text, timeZone, write } from '../../../route.ts';
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
    /** Sent with a digest, so its hour is the person's own until they set it under Settings. */
    timeZone: timeZone.optional(),
  }),
  reply: z.object({ ids: z.array(z.string()) }),
  touches: self,
  run: async ({ db, controls }, { labels, timeZone: zone }) => {
    if (await hasOwnLabels(db)) throw new Refusal('You have labels already. Change them on the Labels screen.');
    const wanted = labels.map(({ disposition, markRead, unsubscribe, ...rest }) => ({
      ...rest,
      ...fromOutcome(disposition),
      ...(markRead ? { markRead } : {}),
      ...(unsubscribe ? { unsubscribe } : {}),
    }));
    const added = await db.transaction(async (tx) => await addLabels(tx, wanted));
    if (zone !== undefined && wanted.some((l) => l.digest)) await rememberTimeZone(db, zone);
    await controls?.checkNow(db);
    return { ids: added.map((l) => l.id) };
  },
});
