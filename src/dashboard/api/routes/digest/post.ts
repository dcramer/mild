import { z } from 'zod';
import { setDigestTime } from '../../../../store/preferences.ts';
import { done, self, timeZone, write } from '../../route.ts';

/** The hour of the person's own day their digests arrive, in the zone their browser is in. */
export default write({
  path: '/api/digest',
  body: z.strictObject({ hour: z.int().min(0).max(23), timeZone }),
  reply: done,
  touches: self,
  run: async ({ db }, { hour, timeZone: zone }) => {
    await setDigestTime(db, hour, zone);
    return { ok: true as const };
  },
});
