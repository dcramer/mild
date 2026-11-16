import { z } from 'zod';
import { DEFAULT_EVAL_EXAMPLES, MAX_EVAL_EXAMPLES, listEvalRuns } from '../../../../learn/evals.ts';
import { and, count, eq, examples, isNotNull } from '../../../../store/query.ts';
import { sees } from '../../../scope.ts';
import { Evals } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({
  path: '/api/evals',
  query: z.object({}),
  reply: Evals,
  run: async ({ db }, scope) => {
    const counts = await Promise.all(
      scope.accounts.map(
        async (id) =>
          [
            id,
            (
              await db
                .select({ n: count() })
                .from(examples)
                .where(and(eq(examples.accountId, id), eq(examples.status, 'captured'), isNotNull(examples.labelId)))
            )[0]!.n,
          ] as const,
      ),
    );
    const evals: Evals = {
      runs: (await listEvalRuns(db)).filter((run) => sees(scope, run.accountId)),
      examples: Object.fromEntries(counts.filter(([, n]) => n > 0)),
      defaultLimit: DEFAULT_EVAL_EXAMPLES,
      maxLimit: MAX_EVAL_EXAMPLES,
    };
    return ok(evals);
  },
});
