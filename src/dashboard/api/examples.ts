import { listAccounts } from '../../store/accounts.ts';
import { deleteExamples, listExamples } from '../../store/examples.ts';
import { sees } from '../scope.ts';
import type { Examples } from '../types.ts';
import { type Read, type Write, missing, named, ok, str } from './route.ts';

export const reads: Read[] = [
  {
    path: '/api/examples',
    run: ({ db, controls }, scope, query) => {
      const one = query.get('account');
      if (one && !sees(scope, one)) return missing('No such mailbox');
      const held = db.prepare('SELECT count(*) AS n FROM examples WHERE account_id = ?');
      const examples: Examples = {
        examples: (one ? [one] : scope.accounts).flatMap((id) => listExamples(db, id)),
        held: Object.fromEntries(scope.accounts.map((id) => [id, (held.get(id) as { n: number }).n] as const).filter(([, n]) => n > 0)),
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
    run: ({ db }, body) => {
      const { accountId, messageId } = body;
      if (!str(accountId) || !str(messageId)) return null;
      return { deleted: deleteExamples(db, accountId, messageId) };
    },
  },
  {
    path: '/api/examples/delete-all',
    touches: named,
    run: ({ db }, body) => {
      const { accountId } = body;
      if (!str(accountId) || !listAccounts(db).some((a) => a.id === accountId)) return null;
      return { deleted: deleteExamples(db, accountId) };
    },
  },
];
