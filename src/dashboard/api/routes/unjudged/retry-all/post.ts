import { z } from 'zod';
import { putAllBackInQueue } from '../../../../../store/runs.ts';
import { write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

export default write({
  path: '/api/unjudged/retry-all',
  body: z.strictObject({}),
  reply: z.object({ retried: z.number() }),
  touches: () => 'self',
  run: async ({ db, controls, now }, _body, scope) => {
    const retried = await putAllBackInQueue(db, scope.accounts, now());
    if (retried === 0) throw new Refusal('Nothing the model failed on is left to retry.');
    await controls?.checkNow(db);
    return { retried };
  },
});
