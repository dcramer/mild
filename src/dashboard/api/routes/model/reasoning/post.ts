import { z } from 'zod';
import { REASONING } from '../../../../../model/reasoning.ts';
import { setReasoning } from '../../../../../store/preferences.ts';
import { done, self, write } from '../../../route.ts';

/** How hard the person's model thinks before it answers. */
export default write({
  path: '/api/model/reasoning',
  body: z.strictObject({ reasoning: z.enum(REASONING) }),
  reply: done,
  touches: self,
  run: async ({ db }, { reasoning }) => {
    await setReasoning(db, reasoning);
    return { ok: true as const };
  },
});
