import { z } from 'zod';
import { DEFAULT_EVAL_EXAMPLES, MAX_EVAL_EXAMPLES } from '../../../../learn/evals.ts';
import { evalRuns } from '../../../queries/evals.ts';
import { Evals } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({
  path: '/api/evals',
  query: z.object({}),
  reply: Evals,
  run: async ({ db }, scope) => {
    const evals: Evals = { ...(await evalRuns(db, scope)), defaultLimit: DEFAULT_EVAL_EXAMPLES, maxLimit: MAX_EVAL_EXAMPLES };
    return ok(evals);
  },
});
