import { z } from 'zod';
import { heldExamples } from '../../../queries/evals.ts';
import { Examples } from '../../../types.ts';
import { ok, read } from '../../route.ts';

/** The stored examples in every one of the person's mailboxes, or the one `?mailbox=` names. */
export default read({
  path: '/api/examples',
  query: z.object({}),
  reply: Examples,
  run: async ({ db }, scope) => ok(await heldExamples(db, scope)),
});
