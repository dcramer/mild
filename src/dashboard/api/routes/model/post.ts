import { z } from 'zod';
import { setModel } from '../../../../store/preferences.ts';
import { done, self, text, write } from '../../route.ts';

export default write({
  path: '/api/model',
  body: z.strictObject({
    model: text()
      .regex(/^[^/\s]+\/\S+$/)
      .nullable(),
  }),
  reply: done,
  touches: self,
  run: async ({ db, controls }, { model }) => {
    await setModel(db, model);
    await controls?.checkNow(db);
    return { ok: true as const };
  },
});
