import { z } from 'zod';
import { updateLabel } from '../../../../store/labels.ts';
import { accountId, fromOutcome, named, outcome, redecide, text, write } from '../../route.ts';
import { DESCRIPTION } from '../../shared/labels.ts';
import { Refusal } from '../../../../refusal.ts';

export default write({
  path: '/api/labels',
  body: z.strictObject({
    accountId,
    id: text(40),
    name: text(60).optional(),
    description: DESCRIPTION.optional(),
    disposition: outcome.optional(),
    markRead: z.boolean().optional(),
    unsubscribe: z.boolean().optional(),
  }),
  reply: z.object({ ok: z.literal(true), redecided: z.number() }),
  touches: named,
  run: async ({ db, now }, { accountId, id, disposition, ...rest }) => {
    const change: Parameters<typeof updateLabel>[3] = { ...rest, ...(disposition === undefined ? {} : fromOutcome(disposition)) };
    if (!(await updateLabel(db, accountId, id, change, now()))) throw new Refusal(`There is no label "${id}".`);
    return { ok: true as const, redecided: await redecide(db, now, accountId) };
  },
});
