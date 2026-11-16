import { SignInCode } from '../../../../types.ts';
import { nothing, self, write } from '../../../route.ts';

export default write({
  path: '/api/model/chatgpt',
  body: nothing,
  reply: SignInCode,
  touches: self,
  run: async ({ db, controls }) => {
    if (!controls) throw new Error('This dashboard cannot sign in to a model.');
    return await controls.signInChatGPT(db);
  },
});
