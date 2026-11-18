import { z } from 'zod';
import { updateLabel } from '../../../../store/labels.ts';
import { rememberTimeZone } from '../../../../store/preferences.ts';
import { fromOutcome, outcome, redecide, self, text, timeZone, write } from '../../route.ts';
import { DESCRIPTION } from '../../shared/labels.ts';
import { Refusal } from '../../../../refusal.ts';

/** Change one of the person's labels, for every mailbox of theirs. */
export default write({
  path: '/api/labels',
  body: z.strictObject({
    id: text(40),
    name: text(60).optional(),
    description: DESCRIPTION.optional(),
    disposition: outcome.optional(),
    markRead: z.boolean().optional(),
    unsubscribe: z.boolean().optional(),
    /** Sent with a digest, so its hour is the person's own until they set it under Settings. */
    timeZone: timeZone.optional(),
  }),
  reply: z.object({ ok: z.literal(true), redecided: z.number() }),
  touches: self,
  run: async (ctx, { id, disposition, timeZone: zone, ...rest }) => {
    const { db } = ctx;
    const change: Parameters<typeof updateLabel>[2] = { ...rest, ...(disposition === undefined ? {} : fromOutcome(disposition)) };
    if (!(await updateLabel(db, id, change))) throw new Refusal(`There is no label "${id}".`);
    if (zone !== undefined && change.digest) await rememberTimeZone(db, zone);
    return { ok: true as const, redecided: await redecide(ctx) };
  },
});
