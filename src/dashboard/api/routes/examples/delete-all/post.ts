import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { deleteExamples } from '../../../../../store/examples.ts';
import { accountId, named, write } from '../../../route.ts';
import { deleted } from '../../../shared/examples.ts';

export default write({
  path: '/api/examples/delete-all',
  body: z.strictObject({ accountId }),
  reply: deleted,
  touches: named,
  run: async ({ db }, { accountId }) => {
    if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
    return { deleted: await deleteExamples(db, accountId) };
  },
});
