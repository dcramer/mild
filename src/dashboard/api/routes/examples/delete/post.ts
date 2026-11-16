import { z } from 'zod';
import { deleteExamples } from '../../../../../store/examples.ts';
import { accountId, named, text, write } from '../../../route.ts';
import { deleted } from '../../../shared/examples.ts';

export default write({
  path: '/api/examples/delete',
  body: z.strictObject({ accountId, messageId: text() }),
  reply: deleted,
  touches: named,
  run: async ({ db }, { accountId, messageId }) => ({ deleted: await deleteExamples(db, accountId, messageId) }),
});
