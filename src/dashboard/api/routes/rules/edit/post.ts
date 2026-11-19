import { z } from 'zod';
import { editRule } from '../../../../../store/rules.ts';
import { redecide, self, write } from '../../../route.ts';
import { ruleBody, ruleId, saysEnough, saysOf } from '../../../shared/rules.ts';

/** Change what a rule matches and says, in place. */
export default write({
  path: '/api/rules/edit',
  body: saysEnough(ruleBody.extend({ id: ruleId })),
  reply: z.object({ ok: z.literal(true), redecided: z.number() }),
  touches: self,
  run: async (ctx, { id, match, ...rule }) => {
    await ctx.db.transaction(async (tx) => await editRule(tx, id, match, saysOf(rule), ctx.now()));
    return { ok: true as const, redecided: await redecide(ctx) };
  },
});
