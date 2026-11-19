import { z } from 'zod';
import { count, eq, examples as exampleRows } from '../../../../store/query.ts';
import { listExamples } from '../../../../store/examples.ts';
import { Examples } from '../../../types.ts';
import { ok, read } from '../../route.ts';

/** The stored examples in every one of the person's mailboxes, or the one `?mailbox=` names. */
export default read({
  path: '/api/examples',
  query: z.object({}),
  reply: Examples,
  run: async ({ db }, scope) => {
    const held = await Promise.all(
      scope.accounts.map(async (id) => [id, (await db.select({ n: count() }).from(exampleRows).where(eq(exampleRows.accountId, id)))[0]!.n] as const),
    );
    const examples: Examples = {
      examples: (await Promise.all(scope.accounts.map(async (id) => await listExamples(db, id)))).flat(),
      held: Object.fromEntries(held.filter(([, n]) => n > 0)),
    };
    return ok(examples);
  },
});
