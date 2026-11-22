import { z } from 'zod';
import { listDrafts } from '../../../../../store/drafts.ts';
import { SavedDraft } from '../../../../types.ts';
import { ok, read } from '../../../route.ts';

/** The person's drafts, oldest change first, whole. */
export default read({
  path: '/api/mail/drafts',
  query: z.object({}),
  reply: z.object({ drafts: z.array(SavedDraft) }),
  run: async ({ db }, scope) =>
    ok({
      drafts: (await listDrafts(db, scope.accounts)).map(({ gmailId, pushedAt, ...d }) => ({ ...d, inGmail: gmailId !== null && pushedAt !== null })),
    }),
});
