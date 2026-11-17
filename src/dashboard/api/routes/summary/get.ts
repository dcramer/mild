import { z } from 'zod';
import { summarize } from '../../../queries/summary.ts';
import { Summary } from '../../../types.ts';
import { days, ok, read } from '../../route.ts';

export default read({
  path: '/api/summary',
  query: z.object({ days, label: z.string().optional() }),
  reply: Summary,
  run: async ({ db, now }, scope, { days, label }) => ok(await summarize(db, scope, days, now(), label || undefined)),
});
