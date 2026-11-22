import { z } from 'zod';
import { removeUploads } from '../../../../../../store/uploads.ts';
import { done, self, text, write } from '../../../../route.ts';

/** A file taken off mail being written. */
export default write({
  path: '/api/mail/upload/remove',
  body: z.strictObject({ id: text(64) }),
  reply: done,
  touches: self,
  run: async ({ db }, { id }) => ((await removeUploads(db, [id])) === 0 ? null : { ok: true as const }),
});
