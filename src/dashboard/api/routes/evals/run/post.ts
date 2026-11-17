import { z } from 'zod';
import { DEFAULT_EVAL_EXAMPLES, MAX_EVAL_EXAMPLES } from '../../../../../learn/evals.ts';
import { listAccounts } from '../../../../../store/accounts.ts';
import { EvalRequest } from '../../../../types.ts';
import { named, write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

export default write({
  path: '/api/evals/run',
  body: EvalRequest.extend({ limit: z.int().min(1).max(MAX_EVAL_EXAMPLES).optional() }),
  reply: z.object({ id: z.number() }),
  touches: named,
  run: async ({ db, controls }, { accountId, fewShot, limit }) => {
    if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
    if (!controls) throw new Refusal('This dashboard cannot run the model.');
    return { id: await controls.startEval(db, { accountId, fewShot: fewShot ?? true, limit: limit ?? DEFAULT_EVAL_EXAMPLES }) };
  },
});
