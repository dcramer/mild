import { z } from 'zod';
import { done, self, write } from '../../../route.ts';
import { provider } from '../../../shared/model.ts';

export default write({
  path: '/api/model/signout',
  body: z.strictObject({ provider }),
  reply: done,
  touches: self,
  run: async ({ db, controls }, { provider }) => {
    if (!controls) throw new Error('This dashboard cannot sign out of a model.');
    await controls.signOutModel(db, provider);
    return { ok: true as const };
  },
});
