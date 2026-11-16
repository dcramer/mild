import { z } from 'zod';
import { count, eq, examples as exampleRows } from '../../../../store/query.ts';
import { listExamples } from '../../../../store/examples.ts';
import { sees } from '../../../scope.ts';
import { Examples } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';

export default read({
  path: '/api/examples',
  query: z.object({ account: z.string().optional() }),
  reply: Examples,
  run: async ({ db }, scope, { account: one }) => {
    if (one && !sees(scope, one)) return missing('No such mailbox');
    const held = await Promise.all(
      scope.accounts.map(async (id) => [id, (await db.select({ n: count() }).from(exampleRows).where(eq(exampleRows.accountId, id)))[0]!.n] as const),
    );
    const examples: Examples = {
      examples: (await Promise.all((one ? [one] : scope.accounts).map(async (id) => await listExamples(db, id)))).flat(),
      held: Object.fromEntries(held.filter(([, n]) => n > 0)),
    };
    return ok(examples);
  },
});
