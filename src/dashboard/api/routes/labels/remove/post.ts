import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { listLabels, removeLabel } from '../../../../../store/labels.ts';
import { listRules } from '../../../../../store/rules.ts';
import { redecide, self, text, write } from '../../../route.ts';
import { removeFilter } from '../../../shared/rules.ts';
import { LEAVE_IN_INBOX } from '../../../../../triage/types.ts';
import { Refusal } from '../../../../../refusal.ts';

/**
 * Remove a label from every mailbox of the person's that has it, with the rules that name it. Mail waiting
 * on them with that label is left for them to answer; what earlier mail was stays as it was.
 */
export default write({
  path: '/api/labels/remove',
  body: z.strictObject({ id: text(40) }),
  reply: z.object({ ok: z.literal(true), redecided: z.number() }),
  touches: self,
  run: async (ctx, { id }) => {
    const { db, now } = ctx;
    if (id === LEAVE_IN_INBOX) throw new Refusal('Leave in inbox cannot be removed: it is what mail is when it is none of your labels.');
    const having: string[] = [];
    for (const account of await listAccounts(db)) {
      const labels = await listLabels(db, account.id);
      const label = labels.find((l) => l.id === id);
      if (!label) continue;
      // Without a label of its own a mailbox is read no more, and the dashboard goes back to setting up.
      if (!labels.some((l) => l.id !== id && l.id !== LEAVE_IN_INBOX))
        throw new Refusal(`${label.name} is the last of your labels, and Sift reads no mail without one. Add another first.`);
      having.push(account.id);
    }
    if (having.length === 0) throw new Refusal(`There is no label "${id}".`);
    for (const accountId of having)
      for (const rule of await listRules(db, accountId)) if (rule.labelId === id || rule.whenLabel === id) await removeFilter(ctx, rule.id);
    await db.transaction(async (tx) => {
      for (const accountId of having) await removeLabel(tx, accountId, id, now());
    });
    let redecided = 0;
    for (const accountId of having) redecided += await redecide(db, now, accountId);
    return { ok: true as const, redecided };
  },
});
