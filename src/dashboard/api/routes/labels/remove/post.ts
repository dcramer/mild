import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { listLabels, removeLabel } from '../../../../../store/labels.ts';
import { listRules } from '../../../../../store/rules.ts';
import { redecide, self, text, write } from '../../../route.ts';
import { removeFilter } from '../../../shared/rules.ts';
import { EVERYTHING_ELSE } from '../../../../../triage/types.ts';
import { Refusal } from '../../../../../refusal.ts';

/**
 * Remove a label from every mailbox of the person's that has it, with the rules that name it. Mail waiting
 * on them with that label is left for them to answer; what earlier mail was stays as it was.
 */
export default write({
  path: '/api/labels/remove',
  body: z.strictObject({ id: text(40) }),
  reply: z.object({ ok: z.literal(true), rules: z.number(), redecided: z.number() }),
  touches: self,
  run: async (ctx, { id }) => {
    const { db, now } = ctx;
    if (id === EVERYTHING_ELSE) throw new Refusal('Everything Else cannot be removed: it is what mail is when it is none of your labels.');
    const having: string[] = [];
    for (const account of await listAccounts(db)) if ((await listLabels(db, account.id)).some((l) => l.id === id)) having.push(account.id);
    if (having.length === 0) throw new Refusal(`There is no label "${id}".`);
    let rules = 0;
    for (const accountId of having)
      for (const rule of await listRules(db, accountId))
        if (rule.labelId === id || rule.whenLabel === id) {
          await removeFilter(ctx, rule.id);
          rules++;
        }
    await db.transaction(async (tx) => {
      for (const accountId of having) await removeLabel(tx, accountId, id, now());
    });
    let redecided = 0;
    for (const accountId of having) redecided += await redecide(db, now, accountId);
    return { ok: true as const, rules, redecided };
  },
});
