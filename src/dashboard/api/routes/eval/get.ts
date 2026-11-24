import { z } from 'zod';
import { evalRun } from '../../../queries/evals.ts';
import { EvalDetail } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';

export default read({
  path: '/api/eval',
  query: z.object({ id: z.coerce.number().int() }),
  reply: EvalDetail,
  run: async ({ db }, scope, { id }) => {
    const found = await evalRun(db, scope, id);
    return found ? ok(found) : missing('No such run');
  },
});
