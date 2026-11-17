import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { hasOwnLabels } from '../../../../../store/labels.ts';
import { LabelProposal } from '../../../../types.ts';
import { self, write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

/** Ask the person's model for labels from what they want. Recorded on a mailbox that has none yet, which is what it is for. */
export default write({
  path: '/api/labels/propose',
  body: z.strictObject({ goal: z.string().trim().min(1).max(2000) }),
  reply: LabelProposal,
  touches: self,
  run: async ({ db, controls }, { goal }) => {
    const accounts = await listAccounts(db);
    const bare = [];
    for (const account of accounts) if (!(await hasOwnLabels(db, account.id))) bare.push(account);
    const target = bare[0] ?? accounts[0];
    if (!target) return null;
    if (!controls) throw new Refusal('This dashboard cannot run the model.');
    return await controls.proposeLabels(db, { accountId: target.id, goal });
  },
});
