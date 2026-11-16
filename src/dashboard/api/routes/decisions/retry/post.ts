import { z } from 'zod';
import { decisions } from '../../../../../store/query.ts';
import { retryDecision } from '../../../../queries/decisions.ts';
import { id, ownerOf, write } from '../../../route.ts';

export default write({
  path: '/api/decisions/retry',
  body: z.strictObject({ id }),
  reply: z.object({ retried: z.boolean(), waiting: z.boolean() }),
  touches: ownerOf(decisions),
  run: async ({ db, controls }, { id }, scope) => {
    const result = await retryDecision(db, scope, id);
    if (!result.retried) throw new Error('That change did not fail, so there is nothing to try again.');
    await controls?.checkNow(db);
    return result;
  },
});
