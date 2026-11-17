import { and, decisions, desc, eq, messages, modelRuns, notExists, sql } from '../../store/query.ts';
import { outOfTries } from '../../store/runs.ts';
import type { Sql } from '../../store/sql.ts';
import { openEnvelope } from '../../store/content.ts';
import { type Scope, within } from '../scope.ts';
import type { UnjudgedRow } from '../types.ts';

/** Mail the model failed on too often to try again, so it is out of the queue and no one's suggestion. Newest first. */
export async function listUnjudged(db: Sql, scope: Scope, limit: number): Promise<UnjudgedRow[]> {
  const latest = <T>(column: typeof modelRuns.error | typeof modelRuns.startedAt) =>
    sql<T>`(${db
      .select({ value: column })
      .from(modelRuns)
      .where(and(eq(modelRuns.accountId, messages.accountId), eq(modelRuns.messageId, messages.id)))
      .orderBy(desc(modelRuns.id))
      .limit(1)})`;
  const rows = await db
    .select({
      accountId: messages.accountId,
      messageId: messages.id,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      subject: messages.subject,
      error: latest<string | null>(modelRuns.error),
      triedAt: latest<number | string>(modelRuns.startedAt),
    })
    .from(messages)
    .where(
      and(
        within(scope, messages.accountId),
        notExists(
          db
            .select({ id: decisions.id })
            .from(decisions)
            .where(and(eq(decisions.accountId, messages.accountId), eq(decisions.messageId, messages.id))),
        ),
        outOfTries(db, messages.accountId, messages.id),
      ),
    )
    .orderBy(desc(messages.receivedAt))
    .limit(limit);
  return rows.map((r) => ({ ...openEnvelope(db, r.accountId, r.messageId, r), triedAt: Number(r.triedAt) }));
}
