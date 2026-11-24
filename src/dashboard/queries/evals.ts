import { and, count, eq, examples, isNotNull } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { getEvalRun, listEvalRuns } from '../../learn/evals.ts';
import { listExamples } from '../../store/examples.ts';
import { type Scope, sees } from '../scope.ts';
import type { EvalDetail, Evals, Examples } from '../types.ts';

/** How many of `where`'s examples each of the scope's mailboxes holds, leaving out those with none. */
async function perMailbox(db: Sql, scope: Scope, where: (accountId: string) => ReturnType<typeof and>): Promise<Record<string, number>> {
  const counts = await Promise.all(scope.accounts.map(async (id) => [id, (await db.select({ n: count() }).from(examples).where(where(id)))[0]!.n] as const));
  return Object.fromEntries(counts.filter(([, n]) => n > 0));
}

/** The test runs of the scope's mailboxes, newest first, and how many answered examples each mailbox has to run on. */
export async function evalRuns(db: Sql, scope: Scope): Promise<Pick<Evals, 'runs' | 'examples'>> {
  return {
    runs: (await listEvalRuns(db)).filter((run) => sees(scope, run.accountId)),
    examples: await perMailbox(db, scope, (id) => and(eq(examples.accountId, id), eq(examples.status, 'captured'), isNotNull(examples.labelId))),
  };
}

/** A test run and its results, or null when it is none of the scope's. */
export async function evalRun(db: Sql, scope: Scope, id: number): Promise<EvalDetail | null> {
  const found = await getEvalRun(db, id);
  return found && sees(scope, found.run.accountId) ? found : null;
}

/** The examples held for the scope's mailboxes, and how many each holds. */
export async function heldExamples(db: Sql, scope: Scope): Promise<Examples> {
  return {
    examples: (await Promise.all(scope.accounts.map(async (id) => await listExamples(db, id)))).flat(),
    held: await perMailbox(db, scope, (id) => eq(examples.accountId, id)),
  };
}
