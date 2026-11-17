import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { addLabels } from '../../../../../store/labels.ts';
import { MAX_DRAFTS } from '../../../../../triage/proposal.ts';
import { accountId, fromOutcome, named, outcome, text, write } from '../../../route.ts';
import { DESCRIPTION } from '../../../shared/labels.ts';

/** Make the labels the person kept from a proposal, all or none. The mailbox's first pass follows. */
export default write({
  path: '/api/labels/accept',
  body: z.strictObject({
    accountId,
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
  }),
  reply: z.object({ ids: z.array(z.string()) }),
  touches: named,
  run: async ({ db, controls }, { accountId, labels }) => {
    if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
    const added = await addLabels(
      db,
      accountId,
      labels.map(({ disposition, markRead, unsubscribe, ...rest }) => ({
        ...rest,
        ...fromOutcome(disposition),
        ...(markRead ? { markRead } : {}),
        ...(unsubscribe ? { unsubscribe } : {}),
      })),
    );
    await controls?.checkNow(db);
    return { ids: added.map((l) => l.id) };
  },
});
