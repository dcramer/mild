import { z } from 'zod';
import { giveStanding } from '../../../../store/rules.ts';
import { Given } from '../../../types.ts';
import { redecide, self, text, write } from '../../route.ts';

export default write({
  path: '/api/standing',
  body: z
    .strictObject({
      address: text()
        .regex(/^[^@\s]+@[^@\s]+$/)
        .optional(),
      domain: text()
        .regex(/^[^@\s]+$/)
        .optional(),
      standing: Given,
    })
    .refine((who) => (who.address === undefined) !== (who.domain === undefined), { message: 'Name an address or a domain, and not both.' }),
  /** `theirs`: nothing was written, because their own rule says more than a standing; the page opens the rule dialog instead. */
  reply: z.union([z.object({ id: z.string(), was: Given.nullable() }), z.object({ theirs: z.string() })]),
  touches: self,
  run: async (ctx, { address, domain, standing }) => {
    const { db, now } = ctx;
    const match = address === undefined ? { fromDomain: [domain!.toLowerCase()] as [string] } : { from: [address.toLowerCase()] as [string] };
    const given = await db.transaction((tx) => giveStanding(tx, match, standing, now()));
    if ('id' in given) await redecide(ctx);
    return given;
  },
});
