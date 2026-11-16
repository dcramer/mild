import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { standingRule } from '../../../../../store/rules.ts';
import { removeRuleAndFilter } from '../../../shared/rules.ts';
import { accountId, done, named, text, write } from '../../../route.ts';

export default write({
  path: '/api/standing/clear',
  body: z
    .strictObject({
      accountId,
      address: text()
        .regex(/^[^@\s]+@[^@\s]+$/)
        .optional(),
      domain: text()
        .regex(/^[^@\s]+$/)
        .optional(),
    })
    .refine((who) => (who.address === undefined) !== (who.domain === undefined), { message: 'Name an address or a domain, and not both.' }),
  reply: done,
  touches: named,
  run: async (ctx, { accountId, address, domain }) => {
    if (!(await listAccounts(ctx.db)).some((a) => a.id === accountId)) return null;
    const id = await standingRule(ctx.db, accountId, address === undefined ? { fromDomain: domain!.toLowerCase() } : { from: address.toLowerCase() });
    if (id) await removeRuleAndFilter(ctx, id);
    return { ok: true as const };
  },
});
