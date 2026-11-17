import { z } from 'zod';
import { dismissProposal } from '../../../../store/proposals.ts';
import { proposals } from '../../../../store/query.ts';
import { done, id, ownerOf, write } from '../../route.ts';
import { Refusal } from '../../../../refusal.ts';

export default write({
  path: '/api/proposals',
  body: z.strictObject({ id }),
  reply: done,
  touches: ownerOf(proposals),
  run: async ({ db, now }, { id }) => {
    if (!(await dismissProposal(db, id, now()))) throw new Refusal('That proposal is no longer open.');
    return { ok: true as const };
  },
});
