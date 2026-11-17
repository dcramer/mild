import { z } from 'zod';
import { listFilterChanges } from '../../../queries/rules.ts';
import { FilterChange } from '../../../types.ts';
import { days, ok, read } from '../../route.ts';

export default read({
  path: '/api/filters',
  query: z.object({ days }),
  reply: z.object({ changes: z.array(FilterChange) }),
  run: async ({ db, now }, scope, { days }) => ok({ changes: await listFilterChanges(db, scope, days, now()) }),
});
