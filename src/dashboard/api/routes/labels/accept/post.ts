import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { addInboxWords, addLabels, hasOwnLabels, inboxWords } from '../../../../../store/labels.ts';
import { MAX_DRAFTS } from '../../../../../triage/proposal.ts';
import { fromOutcome, outcome, self, text, write } from '../../../route.ts';
import { DESCRIPTION } from '../../../shared/labels.ts';
import { Refusal } from '../../../../../refusal.ts';

/**
 * Make the labels the person kept from a proposal in every mailbox of theirs that has none yet, all or none,
 * with what they kept of what always stays in the inbox. The first pass of each follows.
 */
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
    inbox: DESCRIPTION.optional(),
  }),
  reply: z.object({ ids: z.array(z.string()) }),
  touches: self,
  run: async ({ db, controls }, { labels, inbox }) => {
    const accounts = await listAccounts(db);
    const bare: string[] = [];
    for (const account of accounts) if (!(await hasOwnLabels(db, account.id))) bare.push(account.id);
    // A mailbox connected later takes what was said before for the others too.
    const said = await inboxWords(
      db,
      accounts.map((a) => a.id),
    );
    if (bare.length === 0) throw new Refusal('Your mailboxes have labels already. Change them on the Labels screen.');
    const wanted = labels.map(({ disposition, markRead, unsubscribe, ...rest }) => ({
      ...rest,
      ...fromOutcome(disposition),
      ...(markRead ? { markRead } : {}),
      ...(unsubscribe ? { unsubscribe } : {}),
    }));
    const added = await db.transaction(async (tx) => {
      const each = [];
      for (const accountId of bare) {
        each.push(await addLabels(tx, accountId, wanted));
        await addInboxWords(tx, accountId, said, inbox ?? '');
      }
      return each[0]!;
    });
    await controls?.checkNow(db);
    return { ids: added.map((l) => l.id) };
  },
});
