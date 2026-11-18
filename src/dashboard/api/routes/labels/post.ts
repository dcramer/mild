import { z } from 'zod';
import { updateLabel } from '../../../../store/labels.ts';
import { fromOutcome, outcome, redecide, self, text, write } from '../../route.ts';
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
  }),
  reply: z.object({ ok: z.literal(true), redecided: z.number() }),
  touches: self,
  run: async (ctx, { id, disposition, ...rest }) => {
    const { db } = ctx;
    const change: Parameters<typeof updateLabel>[2] = { ...rest, ...(disposition === undefined ? {} : fromOutcome(disposition)) };
    if (!(await updateLabel(db, id, change))) throw new Refusal(`There is no label "${id}".`);
    return { ok: true as const, redecided: await redecide(ctx) };
  },
});
