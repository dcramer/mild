import { z } from 'zod';
import { RuleDraft } from '../../../../types.ts';
import { accountId, named, write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

/** Ask the person's model to fill in a rule from their words. Nothing is made: the dialog shows it. */
export default write({
  path: '/api/rules/draft',
  body: z.strictObject({ accountId, goal: z.string().trim().min(1).max(2000) }),
  reply: RuleDraft,
  touches: named,
  run: async ({ db, controls }, request) => {
    if (!controls) throw new Refusal('This dashboard cannot run the model.');
    return await controls.draftRule(db, request);
  },
});
