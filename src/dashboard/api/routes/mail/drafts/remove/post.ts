import { z } from 'zod';
import { removeDraft } from '../../../../../../store/drafts.ts';
import { reportError } from '../../../../../../telemetry.ts';
import { done, self, text, write } from '../../../../route.ts';

/** A draft discarded, and Gmail's copy of it. One already gone is not refused: another device discarded or sent it. */
export default write({
  path: '/api/mail/drafts/remove',
  body: z.strictObject({ id: text(100) }),
  reply: done,
  touches: self,
  run: async ({ db, controls }, { id }) => {
    const gone = await removeDraft(db, id);
    if (gone?.gmailId && controls) await controls.dropDraft(db, { id, accountId: gone.accountId, gmailId: gone.gmailId }).catch(reportError);
    return { ok: true as const };
  },
});
