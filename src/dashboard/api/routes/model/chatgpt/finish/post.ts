import { z } from 'zod';
import { done, self, text, write } from '../../../../route.ts';

export default write({
  path: '/api/model/chatgpt/finish',
  body: z.strictObject({ address: text(4000) }),
  reply: done,
  touches: self,
  run: async ({ db, controls }, { address }) => {
    if (!controls) throw new Error('This dashboard cannot sign in to a model.');
    await controls.finishChatGPT(db, address.trim());
    return { ok: true as const };
  },
});
