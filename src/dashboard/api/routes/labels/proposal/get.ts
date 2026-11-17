import { z } from 'zod';
import { latestLabelProposal } from '../../../../../store/labels.ts';
import { LabelProposal } from '../../../../types.ts';
import { ok, read } from '../../../route.ts';

export default read({
  path: '/api/labels/proposal',
  query: z.object({}),
  reply: z.object({ proposal: LabelProposal.nullable() }),
  run: async ({ db }, scope) => ok({ proposal: await latestLabelProposal(db, scope.accounts) }),
});
