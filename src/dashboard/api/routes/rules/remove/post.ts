import { z } from 'zod';
import { self, write } from '../../../route.ts';
import { removeRuleAndFilter, ruleId } from '../../../shared/rules.ts';

export default write({
  path: '/api/rules/remove',
  body: z.strictObject({ id: ruleId }),
  reply: z.object({ ok: z.literal(true), redecided: z.number() }),
  touches: self,
  run: async (ctx, { id }) => ({ ok: true as const, redecided: await removeRuleAndFilter(ctx, id) }),
});
