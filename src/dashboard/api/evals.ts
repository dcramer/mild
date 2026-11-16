import { DEFAULT_EVAL_EXAMPLES, MAX_EVAL_EXAMPLES, getEvalRun, listEvalRuns } from '../../learn/evals.ts';
import { listAccounts } from '../../store/accounts.ts';
import { sees } from '../scope.ts';
import type { Evals } from '../types.ts';
import { type Read, type Write, missing, named, ok, str } from './route.ts';

export const reads: Read[] = [
  {
    path: '/api/evals',
    run: ({ db }, scope) => {
      const counts = db.prepare(`SELECT count(*) AS n FROM examples WHERE account_id = ? AND status = 'captured' AND label_id IS NOT NULL`);
      const evals: Evals = {
        runs: listEvalRuns(db).filter((run) => sees(scope, run.accountId)),
        examples: Object.fromEntries(scope.accounts.map((id) => [id, (counts.get(id) as { n: number }).n] as const).filter(([, n]) => n > 0)),
        defaultLimit: DEFAULT_EVAL_EXAMPLES,
        maxLimit: MAX_EVAL_EXAMPLES,
      };
      return ok(evals);
    },
  },
  {
    path: '/api/eval',
    run: ({ db }, scope, query) => {
      const found = getEvalRun(db, Number(query.get('id')));
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
      if (!listAccounts(db).some((a) => a.id === accountId)) return null;
      if (!controls) throw new Error('This dashboard cannot run the model.');
      return { id: await controls.startEval({ accountId, fewShot: fewShot ?? controls.settings().fewShot, limit: limit ?? DEFAULT_EVAL_EXAMPLES }) };
    },
  },
];
