import { z } from 'zod';
import { listAccounts } from '../../../../store/accounts.ts';
import { listLabels, updateLabel } from '../../../../store/labels.ts';
import { fromOutcome, outcome, redecide, self, text, write } from '../../route.ts';
import { DESCRIPTION } from '../../shared/labels.ts';
import { Refusal } from '../../../../refusal.ts';

/** Change a label in every mailbox of the person's that has it: a label is one thing to them, wherever their mail is. */
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
  run: async ({ db, now }, { id, disposition, ...rest }) => {
    const change: Parameters<typeof updateLabel>[3] = { ...rest, ...(disposition === undefined ? {} : fromOutcome(disposition)) };
    const having: string[] = [];
    for (const account of await listAccounts(db)) if ((await listLabels(db, account.id)).some((l) => l.id === id)) having.push(account.id);
    if (having.length === 0) throw new Refusal(`There is no label "${id}".`);
    await db.transaction(async (tx) => {
      for (const accountId of having) await updateLabel(tx, accountId, id, change);
    });
    let redecided = 0;
    for (const accountId of having) redecided += await redecide(db, now, accountId);
    return { ok: true as const, redecided };
  },
});
