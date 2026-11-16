import { z } from 'zod';
import { setActive } from '../../../../store/preferences.ts';
import { done, self, write } from '../../route.ts';

export default write({
  path: '/api/active',
  body: z.strictObject({ active: z.boolean() }),
  reply: done,
  touches: self,
  run: async ({ db, controls }, { active }) => {
    await setActive(db, active);
    await controls?.checkNow(db);
    return { ok: true as const };
  },
});
