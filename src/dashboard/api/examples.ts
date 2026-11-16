import { z } from 'zod';
import { listAccounts } from '../../store/accounts.ts';
import { count, eq, examples as exampleRows } from '../../store/query.ts';
import { deleteExamples, listExamples } from '../../store/examples.ts';
import { sees } from '../scope.ts';
import { Examples } from '../types.ts';
import { type Read, type Write, accountId, missing, named, ok, read, text, write } from './route.ts';

const deleted = z.object({ deleted: z.number() });

export const reads: Read[] = [
  read({
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
  }),
];

export const writes: Write[] = [
  write({
    path: '/api/examples/delete',
    body: z.strictObject({ accountId, messageId: text() }),
    reply: deleted,
    touches: named,
    run: async ({ db }, { accountId, messageId }) => ({ deleted: await deleteExamples(db, accountId, messageId) }),
  }),
  write({
    path: '/api/examples/delete-all',
    body: z.strictObject({ accountId }),
    reply: deleted,
    touches: named,
    run: async ({ db }, { accountId }) => {
      if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
      return { deleted: await deleteExamples(db, accountId) };
    },
  }),
];
