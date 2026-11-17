import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { addInboxWords, addLabels, inboxWords } from '../../../../../store/labels.ts';
import { MAX_DRAFTS } from '../../../../../triage/proposal.ts';
import { fromOutcome, outcome, self, text, write } from '../../../route.ts';
import { DESCRIPTION } from '../../../shared/labels.ts';

/**
 * Add labels of the person's own, by hand or kept from what the model suggested, in every mailbox of theirs,
 * with what they kept of what always stays in the inbox: all or none.
 */
export default write({
  path: '/api/labels/add',
  body: z
    .strictObject({
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
        .max(MAX_DRAFTS),
      /** Added to what they said before always stays in the inbox. */
      inbox: DESCRIPTION.optional(),
    })
    .refine((body) => body.labels.length > 0 || !!body.inbox?.trim(), 'Nothing to add.'),
  reply: z.object({ ids: z.array(z.string()) }),
  touches: self,
  run: async ({ db }, { labels, inbox }) => {
    const accounts = await listAccounts(db);
    if (accounts.length === 0) return null;
    const said = await inboxWords(
      db,
      accounts.map((a) => a.id),
    );
    const wanted = labels.map(({ disposition, markRead, unsubscribe, ...rest }) => ({
      ...rest,
      ...fromOutcome(disposition),
      ...(markRead ? { markRead } : {}),
      ...(unsubscribe ? { unsubscribe } : {}),
    }));
    const added = await db.transaction(async (tx) => {
      const each = [];
      for (const account of accounts) {
        each.push(await addLabels(tx, account.id, wanted));
        if (inbox) await addInboxWords(tx, account.id, said, inbox);
      }
      return each[0]!;
    });
    return { ids: added.map((l) => l.id) };
  },
});
