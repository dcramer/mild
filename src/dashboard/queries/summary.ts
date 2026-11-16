import {
  actions,
  alias,
  and,
  asc,
  count,
  decisions,
  desc,
  eq,
  gte,
  inArray,
  mailboxes,
  max,
  messages,
  modelRuns,
  ne,
  not,
  notExists,
  sql,
} from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { outOfTries } from '../../store/runs.ts';
import { accuracy } from '../../learn/feedback.ts';
import { type Scope, within } from '../scope.ts';
import { type DayChanges, STAGES, type StageKey, type Summary } from '../types.ts';
import { DAY_MS, listDecisions } from './decisions.ts';

const emptyCounts = () => Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<StageKey, number>;

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Everything the dashboard shows, for the last `days` days. Read-only. */
export async function summarize(db: Sql, scope: Scope, days: number, now: number = Date.now()): Promise<Summary> {
  const since = now - days * DAY_MS;
  const decidedSince = and(gte(decisions.decidedAt, since), within(scope, decisions.accountId));

  const accounts = await db
    .select({ email: mailboxes.id, lastSyncedAt: mailboxes.lastSyncedAt })
    .from(mailboxes)
    .where(within(scope, mailboxes.id))
    .orderBy(asc(mailboxes.id));
  const [decisionTotals] = (await db
    .select({
      n: count(),
      free: sql<number>`count(*) FILTER (WHERE ${decisions.runId} IS NULL)`.mapWith(Number),
    })
    .from(decisions)
    .where(decidedSince)) as [{ n: number; free: number | null }];
  // Every call costs, the ones that failed included, so cost is summed over runs rather than decisions.
  const ranSince = and(gte(modelRuns.startedAt, since), within(scope, modelRuns.accountId));
  const runs = await db.select({ startedAt: modelRuns.startedAt, costUsd: modelRuns.costUsd }).from(modelRuns).where(ranSince);

  const stageRows = await db
    .select({
      stage: decisions.stage,
      n: count(),
      cost: sql<number>`coalesce(sum(${modelRuns.costUsd}), 0)`.mapWith(Number),
      tokens: sql<number>`coalesce(sum(${modelRuns.inputTokens} + ${modelRuns.outputTokens}), 0)`.mapWith(Number),
    })
    .from(decisions)
    .leftJoin(modelRuns, eq(modelRuns.id, decisions.runId))
    .where(decidedSince)
    .groupBy(decisions.stage);
  const byStage = STAGES.map((stage) => {
    const row = stageRows.find((r) => r.stage === stage);
    return { stage, decisions: row?.n ?? 0, costUsd: row?.cost ?? 0, tokens: row?.tokens ?? 0 };
  });

  const dailyByDay = new Map<string, { counts: Record<StageKey, number>; changes: DayChanges; costUsd: number }>();
  for (let i = days - 1; i >= 0; i--)
    dailyByDay.set(localDay(now - i * DAY_MS), { counts: emptyCounts(), changes: { archive: 0, spam: 0, keep: 0, failed: 0 }, costUsd: 0 });
  for (const row of await db.select({ decidedAt: decisions.decidedAt, stage: decisions.stage }).from(decisions).where(decidedSince)) {
    const day = dailyByDay.get(localDay(row.decidedAt));
    if (day) day.counts[row.stage]++;
  }
  for (const run of runs) {
    const day = dailyByDay.get(localDay(run.startedAt));
    if (day) day.costUsd += run.costUsd;
  }
  // What was done in Gmail each day: a change that stands, by what it did, or one that failed. Undone ones are not counted.
  const latest = alias(actions, 'latest');
  for (const row of await db
    .select({ decidedAt: decisions.decidedAt, disposition: decisions.disposition, block: decisions.block, outcome: decisions.outcome, status: actions.status })
    .from(decisions)
    .leftJoin(
      actions,
      eq(
        actions.id,
        db
          .select({ id: max(latest.id) })
          .from(latest)
          .where(and(eq(latest.decisionId, decisions.id), ne(latest.type, 'unsubscribe'))),
      ),
    )
    .where(and(decidedSince, eq(decisions.mode, 'act')))) {
    const day = dailyByDay.get(localDay(row.decidedAt));
    if (!day) continue;
    if (row.outcome === 'failed' || row.outcome === 'unknown' || row.status === 'failed' || row.status === 'unknown') day.changes.failed++;
    else if (row.status === 'done') {
      const what = row.block ? 'spam' : row.disposition;
      if (what === 'archive' || what === 'spam' || what === 'keep') day.changes[what]++;
    }
  }

  const answered = await accuracy(db, since, scope.accounts);
  const sent = alias(messages, 'sent');

  return {
    days,
    generatedAt: now,
    accounts,
    totals: {
      messages: (
        await db
          .select({ n: count() })
          .from(messages)
          .where(and(gte(messages.receivedAt, since), within(scope, messages.accountId)))
      )[0]!.n,
      decisions: decisionTotals.n,
      withoutInference: decisionTotals.free ?? 0,
      costUsd: runs.reduce((sum, run) => sum + run.costUsd, 0),
      awaitingTriage: (
        await db
          .select({ n: count() })
          .from(messages)
          .where(
            and(
              within(scope, messages.accountId),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(decisions)
                  .where(and(eq(decisions.accountId, messages.accountId), eq(decisions.messageId, messages.id))),
              ),
              not(outOfTries(db, messages.accountId, messages.id)),
            ),
          )
      )[0]!.n,
      troubledActions: (
        await db
          .select({ n: count() })
          .from(actions)
          .where(and(gte(actions.createdAt, since), inArray(actions.status, ['failed', 'unknown', 'pending']), within(scope, actions.accountId)))
      )[0]!.n,
    },
    byStage,
    byDisposition: (
      await db
        .select({ disposition: decisions.disposition, n: count() })
        .from(decisions)
        .where(decidedSince)
        .groupBy(decisions.disposition)
        .orderBy(desc(count()))
    ).map((r) => ({ disposition: r.disposition, decisions: r.n })),
    daily: [...dailyByDay].map(([day, { counts, changes, costUsd }]) => ({ day, counts, changes, costUsd })),
    topSenders: (
      await db
        .select({
          address: messages.fromAddress,
          n: count(),
          last: sql<string | null>`${db
            .select({ disposition: decisions.disposition })
            .from(decisions)
            .innerJoin(sent, and(eq(sent.accountId, decisions.accountId), eq(sent.id, decisions.messageId)))
            .where(and(eq(sent.fromAddress, messages.fromAddress), within(scope, decisions.accountId)))
            .orderBy(desc(decisions.id))
            .limit(1)}`,
        })
        .from(messages)
        .where(and(gte(messages.receivedAt, since), within(scope, messages.accountId)))
        .groupBy(messages.fromAddress)
        .orderBy(desc(count()), asc(messages.fromAddress))
        .limit(10)
    ).map((r) => ({ address: r.address, messages: r.n, lastDisposition: r.last })),
    recent: (await listDecisions(db, scope, { days, limit: 10 }, now)).rows,
    accuracy: { ...answered, byStage: STAGES.map((stage) => answered.byStage.find((r) => r.stage === stage) ?? { stage, reviewed: 0, right: 0 }) },
  };
}
