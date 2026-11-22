import { z } from 'zod';
import { Refusal } from '../../../../../refusal.ts';
import { preferences } from '../../../../../store/preferences.ts';
import { MOST_ATTACHED, PIECE_BYTES, startUpload } from '../../../../../store/uploads.ts';
import { self, text, write } from '../../../route.ts';

/** Begin a file to attach to mail being written. Its bytes follow in pieces (`/api/mail/upload/piece`), each at most `piece` long. */
export default write({
  path: '/api/mail/upload',
  body: z.strictObject({ name: text(255), type: z.string().max(255), size: z.int().nonnegative().max(MOST_ATTACHED) }),
  reply: z.object({ id: z.string(), piece: z.int() }),
  touches: self,
  run: async ({ db, now }, file) => {
    if (!(await preferences(db)).mail) throw new Refusal('Turn Inbox on to send mail from Mild.');
    return { id: await startUpload(db, file, now()), piece: PIECE_BYTES };
  },
});
