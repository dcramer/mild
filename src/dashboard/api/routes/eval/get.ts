import { z } from 'zod';
import { getEvalRun } from '../../../../learn/evals.ts';
import { sees } from '../../../scope.ts';
import { EvalDetail } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';

export default read({
  path: '/api/eval',
  query: z.object({ id: z.coerce.number().int() }),
  reply: EvalDetail,
  run: async ({ db }, scope, { id }) => {
    const found = await getEvalRun(db, id);
    return found && sees(scope, found.run.accountId) ? ok(found) : missing('No such run');
  },
});
