import { z } from 'zod';
import { suggestAddresses } from '../../../../queries/addresses.ts';
import { AddressSuggestion } from '../../../../types.ts';
import { ok, read } from '../../../route.ts';

/** Whom to suggest as an address is typed in the composer (`q`). */
export default read({
  path: '/api/mail/addresses',
  query: z.object({ q: z.string().max(200), limit: z.coerce.number().int().positive().max(20).catch(8) }),
  reply: z.object({ addresses: z.array(AddressSuggestion) }),
  run: async ({ db }, scope, { q, limit }) => ok({ addresses: await suggestAddresses(db, scope, q, limit) }),
});
