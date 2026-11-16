import { z } from 'zod';

import { listDecisions } from '../../../queries/decisions.ts';
import { DecisionPage } from '../../../types.ts';
import { days, ok, read } from '../../route.ts';

/** A filter left empty is no filter. */
const filter = z.string().optional();

export default read({
  path: '/api/decisions',
  query: z.object({
    days,
    stage: filter,
    disposition: filter,
    status: filter,
    q: filter,
    fact: filter,
    limit: z.coerce.number().int().positive().catch(50),
    offset: z.coerce.number().int().nonnegative().catch(0),
  }),
  reply: DecisionPage,
  run: async ({ db, now }, scope, { days, stage, disposition, status, q, fact, limit, offset }) =>
    ok(
      await listDecisions(
        db,
        scope,
        {
          days,
          ...(stage ? { stage } : {}),
          ...(disposition ? { disposition } : {}),
          ...(status ? { status } : {}),
          ...(q ? { search: q } : {}),
          ...(fact ? { fact } : {}),
          limit,
          offset,
        },
        now(),
      ),
    ),
});
