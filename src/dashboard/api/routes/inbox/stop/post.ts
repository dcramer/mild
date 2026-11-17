import { stopInboxRuns } from '../../../../../store/inbox.ts';
import { done, nothing, self, write } from '../../../route.ts';

export default write({
  path: '/api/inbox/stop',
  body: nothing,
  reply: done,
  touches: self,
  run: async ({ db, now }) => {
    await stopInboxRuns(db, now());
    return { ok: true as const };
  },
});
