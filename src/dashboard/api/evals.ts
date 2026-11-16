import { z } from 'zod';
import { DEFAULT_EVAL_EXAMPLES, MAX_EVAL_EXAMPLES, getEvalRun, listEvalRuns } from '../../learn/evals.ts';
import { listAccounts } from '../../store/accounts.ts';
import { and, count, eq, examples, isNotNull } from '../../store/query.ts';
import { sees } from '../scope.ts';
import { EvalDetail, EvalRequest, Evals } from '../types.ts';
import { type Read, type Write, missing, named, ok, read, write } from './route.ts';

export const reads: Read[] = [
  read({
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
  }),
  read({
    path: '/api/eval',
    query: z.object({ id: z.coerce.number().int() }),
    reply: EvalDetail,
    run: async ({ db }, scope, { id }) => {
      const found = await getEvalRun(db, id);
      return found && sees(scope, found.run.accountId) ? ok(found) : missing('No such run');
    },
  }),
];

export const writes: Write[] = [
  write({
    path: '/api/evals/run',
    body: EvalRequest.extend({ limit: z.int().min(1).max(MAX_EVAL_EXAMPLES).optional() }),
    reply: z.object({ id: z.number() }),
    touches: named,
    run: async ({ db, controls }, { accountId, fewShot, limit }) => {
      if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
      if (!controls) throw new Error('This dashboard cannot run the model.');
      return { id: await controls.startEval(db, { accountId, fewShot: fewShot ?? true, limit: limit ?? DEFAULT_EVAL_EXAMPLES }) };
    },
  }),
];
