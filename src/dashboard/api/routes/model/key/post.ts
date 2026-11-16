import { z } from 'zod';
import { done, self, text, write } from '../../../route.ts';
import { provider } from '../../../shared/model.ts';

export default write({
  path: '/api/model/key',
  body: z.strictObject({ provider, key: text(500) }),
  reply: done,
  touches: self,
  run: async ({ db, controls }, { provider, key }) => {
    if (!controls) throw new Error('This dashboard cannot sign in to a model.');
    await controls.saveModelKey(db, provider, key.trim());
    return { ok: true as const };
  },
});
