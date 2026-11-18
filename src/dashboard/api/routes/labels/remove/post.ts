import { z } from 'zod';
import { listLabels, removeLabel } from '../../../../../store/labels.ts';
import { listRules } from '../../../../../store/rules.ts';
import { redecide, self, text, write } from '../../../route.ts';
import { removeFilter } from '../../../shared/rules.ts';
import { LEAVE_IN_INBOX } from '../../../../../triage/types.ts';
import { Refusal } from '../../../../../refusal.ts';

/**
 * Remove one of the person's labels, with the rules that name it. Mail waiting on them with that label is left
 * for them to answer; what earlier mail was stays as it was.
 */
export default write({
  path: '/api/labels/remove',
  body: z.strictObject({ id: text(40) }),
  reply: z.object({ ok: z.literal(true), redecided: z.number() }),
  touches: self,
  run: async (ctx, { id }) => {
    const { db, now } = ctx;
    if (id === LEAVE_IN_INBOX) throw new Refusal('Leave in inbox cannot be removed: it is where mail stays when none of your labels should move it.');
    const labels = await listLabels(db);
    const label = labels.find((l) => l.id === id);
    if (!label) throw new Refusal(`There is no label "${id}".`);
    // Without a label of their own nothing is read from their Gmail, and the dashboard goes back to setting up.
    if (!labels.some((l) => l.id !== id && l.id !== LEAVE_IN_INBOX))
      throw new Refusal(`${label.name} is the last of your labels, and Sift reads no mail without one. Add another first.`);
    for (const rule of await listRules(db)) if (rule.labelId === id || rule.whenLabel === id) await removeFilter(ctx, rule.id);
    await removeLabel(db, id, now());
    return { ok: true as const, redecided: await redecide(db, now) };
  },
});
