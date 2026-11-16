import { z } from 'zod';
import { listChanges } from '../../../queries/decisions.ts';
import { ChangeRow } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({
  path: '/api/changes',
  query: z.object({}),
  reply: z.object({ changes: z.array(ChangeRow) }),
  run: async ({ db }, scope) => ok({ changes: await listChanges(db, scope, 200) }),
});
