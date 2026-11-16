import { z } from 'zod';
import { listUnjudged } from '../../../queries/runs.ts';
import { UnjudgedRow } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({
  path: '/api/unjudged',
  query: z.object({}),
  reply: z.object({ rows: z.array(UnjudgedRow) }),
  run: async ({ db }, scope) => ok({ rows: await listUnjudged(db, scope, 200) }),
});
