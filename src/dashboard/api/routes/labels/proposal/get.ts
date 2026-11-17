import { z } from 'zod';
import { latestLabelProposal } from '../../../../../store/labels.ts';
import { sees } from '../../../../scope.ts';
import { LabelProposal } from '../../../../types.ts';
import { missing, ok, read } from '../../../route.ts';

export default read({
  path: '/api/labels/proposal',
  query: z.object({ account: z.string() }),
  reply: z.object({ proposal: LabelProposal.nullable() }),
  run: async ({ db }, scope, { account }) => (sees(scope, account) ? ok({ proposal: await latestLabelProposal(db, account) }) : missing('No such mailbox')),
});
