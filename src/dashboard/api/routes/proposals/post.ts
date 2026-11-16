import { z } from 'zod';
import { resolveProposal } from '../../../../store/proposals.ts';
import { proposals } from '../../../../store/query.ts';
import { done, id, ownerOf, write } from '../../route.ts';

export default write({
  path: '/api/proposals',
  body: z.strictObject({ id, accept: z.boolean() }),
  reply: done,
  touches: ownerOf(proposals),
  run: async ({ db, now }, { id, accept }) => {
    if (!(await resolveProposal(db, id, accept, now()))) throw new Error('That proposal is no longer open.');
    return { ok: true as const };
  },
});
