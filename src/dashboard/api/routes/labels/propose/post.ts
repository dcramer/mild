import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { LabelProposal } from '../../../../types.ts';
import { accountId, named, write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

export default write({
  path: '/api/labels/propose',
  body: z.strictObject({ accountId, goal: z.string().trim().min(1).max(2000) }),
  reply: LabelProposal,
  touches: named,
  run: async ({ db, controls }, { accountId, goal }) => {
    if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
    if (!controls) throw new Refusal('This dashboard cannot run the model.');
    return await controls.proposeLabels(db, { accountId, goal });
  },
});
