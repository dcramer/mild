import { z } from 'zod';
import { standingRule } from '../../../../../store/rules.ts';
import { removeRuleAndFilter } from '../../../shared/rules.ts';
import { done, self, text, write } from '../../../route.ts';

export default write({
  path: '/api/standing/clear',
  body: z
    .strictObject({
      address: text()
        .regex(/^[^@\s]+@[^@\s]+$/)
        .optional(),
      domain: text()
        .regex(/^[^@\s]+$/)
        .optional(),
    })
    .refine((who) => (who.address === undefined) !== (who.domain === undefined), { message: 'Name an address or a domain, and not both.' }),
  reply: done,
  touches: self,
  run: async (ctx, { address, domain }) => {
    const id = await standingRule(ctx.db, address === undefined ? { fromDomain: [domain!.toLowerCase()] } : { from: [address.toLowerCase()] });
    if (id) await removeRuleAndFilter(ctx, id);
    return { ok: true as const };
  },
});
