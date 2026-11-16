import { z } from 'zod';
import { rules } from '../../../../../store/query.ts';
import { ownerOf, write } from '../../../route.ts';
import { removeRuleAndFilter, ruleId } from '../../../shared/rules.ts';

export default write({
  path: '/api/rules/remove',
  body: z.strictObject({ id: ruleId }),
  reply: z.object({ ok: z.literal(true), redecided: z.number() }),
  touches: ownerOf(rules),
  run: async (ctx, { id }) => ({ ok: true as const, redecided: await removeRuleAndFilter(ctx, id) }),
});
