import { z } from 'zod';
import { summarize } from '../../../queries/summary.ts';
import { Summary } from '../../../types.ts';
import { days, ok, read } from '../../route.ts';

export default read({
  path: '/api/summary',
  query: z.object({ days }),
  reply: Summary,
  run: async ({ db, now }, scope, { days }) => ok(await summarize(db, scope, days, now())),
});
