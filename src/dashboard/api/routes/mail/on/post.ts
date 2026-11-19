import { z } from 'zod';
import { setMail } from '../../../../../store/preferences.ts';
import { done, self, write } from '../../../route.ts';

export default write({
  path: '/api/mail/on',
  body: z.strictObject({ on: z.boolean() }),
  reply: done,
  touches: self,
  run: async ({ db, controls }, { on }) => {
    await setMail(db, on);
    // Its passes fetch the text of what is in the inbox.
    if (on) await controls?.checkNow(db);
    return { ok: true as const };
  },
});
