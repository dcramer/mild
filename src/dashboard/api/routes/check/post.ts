import { done, nothing, write } from '../../route.ts';
import { Refusal } from '../../../../refusal.ts';

export default write({
  path: '/api/check',
  body: nothing,
  reply: done,
  touches: () => 'anyone',
  run: async ({ controls, db }) => {
    if (!controls) throw new Refusal('Only the dashboard is running here, so there is nothing to check with.');
    await controls.checkNow(db);
    return { ok: true as const };
  },
});
