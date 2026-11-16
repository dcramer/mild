import { DEFAULT_EVAL_EXAMPLES, MAX_EVAL_EXAMPLES, getEvalRun, listEvalRuns } from '../../learn/evals.ts';
import { listAccounts } from '../../store/accounts.ts';
import { and, count, eq, examples, isNotNull } from '../../store/query.ts';
import { sees } from '../scope.ts';
import type { Evals } from '../types.ts';
import { type Read, type Write, missing, named, ok, str } from './route.ts';

export const reads: Read[] = [
  {
    path: '/api/evals',
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
  },
  {
    path: '/api/eval',
    run: async ({ db }, scope, query) => {
      const found = await getEvalRun(db, Number(query.get('id')));
      return found && sees(scope, found.run.accountId) ? ok(found) : missing('No such run');
    },
  },
];

export const writes: Write[] = [
  {
    path: '/api/evals/run',
    touches: named,
    run: async ({ db, controls }, body) => {
      const { accountId, fewShot, limit } = body;
      if (!str(accountId) || (fewShot !== undefined && typeof fewShot !== 'boolean')) return null;
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_EVAL_EXAMPLES)) return null;
      if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
      if (!controls) throw new Error('This dashboard cannot run the model.');
      return { id: await controls.startEval(db, { accountId, fewShot: fewShot ?? controls.settings().fewShot, limit: limit ?? DEFAULT_EVAL_EXAMPLES }) };
    },
  },
];
