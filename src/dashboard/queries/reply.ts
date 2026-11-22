import { answering } from '../../store/reply.ts';
import type { Sql } from '../../store/sql.ts';
import { type Scope, sees } from '../scope.ts';

/** What a reply to one of the scope's recorded messages takes from it (`answering`). Null outside the scope. */
export const replyTo = async (db: Sql, scope: Scope, accountId: string, messageId: string) =>
  sees(scope, accountId) ? await answering(db, accountId, messageId) : null;
