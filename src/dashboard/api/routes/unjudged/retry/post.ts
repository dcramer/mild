import { z } from 'zod';
import { putBackInQueue } from '../../../../../store/runs.ts';
import { accountId, named, text, write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

export default write({
  path: '/api/unjudged/retry',
  body: z.strictObject({ accountId, messageId: text() }),
  reply: z.object({ ok: z.literal(true) }),
  touches: named,
  run: async ({ db, controls, now }, { accountId, messageId }) => {
    if (!(await putBackInQueue(db, accountId, messageId, now()))) throw new Refusal('That message is already waiting to be judged.');
    await controls?.checkNow(db);
    return { ok: true as const };
  },
});
