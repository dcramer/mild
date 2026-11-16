import { listAccounts } from '../../store/accounts.ts';
import { count, eq, examples as exampleRows } from '../../store/query.ts';
import { deleteExamples, listExamples } from '../../store/examples.ts';
import { sees } from '../scope.ts';
import type { Examples } from '../types.ts';
import { type Read, type Write, missing, named, ok, str } from './route.ts';

export const reads: Read[] = [
  {
    path: '/api/examples',
    run: async ({ db, controls }, scope, query) => {
      const one = query.get('account');
      if (one && !sees(scope, one)) return missing('No such mailbox');
      const held = await Promise.all(
        scope.accounts.map(async (id) => [id, (await db.select({ n: count() }).from(exampleRows).where(eq(exampleRows.accountId, id)))[0]!.n] as const),
      );
      const examples: Examples = {
        examples: (await Promise.all((one ? [one] : scope.accounts).map(async (id) => await listExamples(db, id)))).flat(),
        held: Object.fromEntries(held.filter(([, n]) => n > 0)),
        keepDays: controls?.settings().examplesKeepDays ?? null,
      };
      return ok(examples);
    },
  },
];

export const writes: Write[] = [
  {
    path: '/api/examples/delete',
    touches: named,
    run: async ({ db }, body) => {
      const { accountId, messageId } = body;
      if (!str(accountId) || !str(messageId)) return null;
      return { deleted: await deleteExamples(db, accountId, messageId) };
    },
  },
  {
    path: '/api/examples/delete-all',
    touches: named,
    run: async ({ db }, body) => {
      const { accountId } = body;
      if (!str(accountId) || !(await listAccounts(db)).some((a) => a.id === accountId)) return null;
      return { deleted: await deleteExamples(db, accountId) };
    },
  },
];
