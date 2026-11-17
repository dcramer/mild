import { z } from 'zod';
import { listAccounts } from '../../../../store/accounts.ts';
import { giveStanding } from '../../../../store/rules.ts';
import { Given } from '../../../types.ts';
import { accountId, named, redecide, text, write } from '../../route.ts';

export default write({
  path: '/api/standing',
  body: z
    .strictObject({
      accountId,
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
  touches: named,
  run: async ({ db, now }, { accountId, address, domain, standing }) => {
    if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
    const match = address === undefined ? { fromDomain: [domain!.toLowerCase()] as [string] } : { from: [address.toLowerCase()] as [string] };
    const given = await db.transaction((tx) => giveStanding(tx, accountId, match, standing, now()));
    if ('id' in given) await redecide(db, now, accountId);
    return given;
  },
});
