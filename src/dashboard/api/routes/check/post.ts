import { done, nothing, write } from '../../route.ts';

export default write({
  path: '/api/check',
  body: nothing,
  reply: done,
  touches: () => 'anyone',
  run: async ({ controls, db }) => {
    if (!controls) throw new Error('Only the dashboard is running here, so there is nothing to check with.');
    await controls.checkNow(db);
    return { ok: true as const };
  },
});
