import {
  actions,
  alias,
  and,
  asc,
  count,
  countDistinct,
  decisions,
  desc,
  eq,
  gte,
  mailboxes,
  max,
  messages,
  min,
  modelRuns,
  ne,
  not,
  sql,
} from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { openNewest } from '../../store/content.ts';
import { outOfTries } from '../../store/runs.ts';
import { noDecision } from '../../store/messages.ts';
import { accuracy } from '../../learn/feedback.ts';
import { type Scope, within } from '../scope.ts';
import { type DayChanges, type StageKey, type Summary } from '../types.ts';
import { STAGE_NAMES } from '../../triage/types.ts';
import { DAY_MS, labelIs, listDecisions } from './decisions.ts';
import { keptOutLessDigests, net, saved, unsubscribed } from './saved.ts';
import { labelNames } from '../../store/labels.ts';

const first = alias(decisions, 'first');

const emptyCounts = () => Object.fromEntries(STAGE_NAMES.map((s) => [s, 0])) as Record<StageKey, number>;

export const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** What the model cost since `since`, every call counted, the failed ones too, and how many messages it was asked about. */
export async function modelSpend(db: Sql, scope: Scope, since: number): Promise<{ costUsd: number; judged: number }> {
  const [row] = await db
    .select({
      costUsd: sql<number>`coalesce(sum(${modelRuns.costUsd}), 0)`.mapWith(Number),
      judged: countDistinct(sql`(${modelRuns.accountId}, ${modelRuns.messageId})`),
    })
    .from(modelRuns)
    .where(and(gte(modelRuns.startedAt, since), within(scope, modelRuns.accountId)));
  return row ?? { costUsd: 0, judged: 0 };
}

/**
 * The ten senders with the most mail since `since`, each with its newest message and what Mild last did with its mail.
 * Counted first, then looked up for those ten alone: gathering every sender's messages to keep one each took seconds.
 */
async function topSenders(db: Sql, scope: Scope, since: number) {
  const inWindow = and(gte(messages.receivedAt, since), within(scope, messages.accountId));
  const busiest = db
    .select({ senderHash: messages.senderHash, n: count().as('n') })
    .from(messages)
    .where(inWindow)
    .groupBy(messages.senderHash)
    .orderBy(desc(count()), asc(messages.senderHash))
    .limit(10)
    .as('busiest');
  const sent = alias(messages, 'sent');
  return await db
    .select({
      n: busiest.n,
      newest: sql<[string, string, string]>`(${db
        .select({ newest: sql`json_build_array(${messages.accountId}, ${messages.id}, ${messages.headers})` })
        .from(messages)
        .where(and(inWindow, eq(messages.senderHash, busiest.senderHash)))
        .orderBy(desc(messages.receivedAt))
        .limit(1)})`.mapWith((v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)),
      last: sql<string | null>`(${db
        .select({ disposition: decisions.disposition })
        .from(decisions)
        .innerJoin(sent, and(eq(sent.accountId, decisions.accountId), eq(sent.id, decisions.messageId)))
        .where(and(eq(sent.senderHash, busiest.senderHash), within(scope, decisions.accountId)))
        .orderBy(desc(decisions.id))
        .limit(1)})`,
    })
    .from(busiest)
    .orderBy(desc(busiest.n), asc(busiest.senderHash));
}

/** Everything the dashboard shows, for the last `days` days; with `label`, how much of each day's mail was that label. Read-only. */
export async function summarize(db: Sql, scope: Scope, days: number, now: number = Date.now(), label?: string): Promise<Summary> {
  const since = now - days * DAY_MS;
  const decidedSince = and(gte(decisions.decidedAt, since), within(scope, decisions.accountId));

  const accounts = await db
    .select({ email: mailboxes.id, lastSyncedAt: mailboxes.lastSyncedAt })
    .from(mailboxes)
    .where(within(scope, mailboxes.id))
    .orderBy(asc(mailboxes.id));
  // Each message once: where Mild first decided it. Later decisions (an answer, a rule or label changed
  // since) are about the same message, and one the user answered before Mild decided it is not Mild's.
  const triagedSince = and(
    decidedSince,
    eq(
      decisions.id,
      db
        .select({ id: min(first.id) })
        .from(first)
        .where(and(eq(first.accountId, decisions.accountId), eq(first.messageId, decisions.messageId))),
    ),
    eq(decisions.byUser, false),
  );
  const [triaged] = (await db
    .select({
      n: count(),
      free: sql<number>`count(*) FILTER (WHERE ${decisions.runId} IS NULL)`.mapWith(Number),
    })
    .from(decisions)
    .where(triagedSince)) as [{ n: number; free: number | null }];
  const runs = await db
    .select({ startedAt: modelRuns.startedAt, costUsd: modelRuns.costUsd })
    .from(modelRuns)
    .where(and(gte(modelRuns.startedAt, since), within(scope, modelRuns.accountId)));
  const spent = await modelSpend(db, scope, since);

  const stageRows = await db
    .select({
      stage: decisions.stage,
      n: count(),
      cost: sql<number>`coalesce(sum(${modelRuns.costUsd}), 0)`.mapWith(Number),
      tokens: sql<number>`coalesce(sum(${modelRuns.inputTokens} + ${modelRuns.outputTokens}), 0)`.mapWith(Number),
    })
    .from(decisions)
    .leftJoin(modelRuns, eq(modelRuns.id, decisions.runId))
    .where(triagedSince)
    .groupBy(decisions.stage);
  const byStage = STAGE_NAMES.map((stage) => {
    const row = stageRows.find((r) => r.stage === stage);
    return { stage, decisions: row?.n ?? 0, costUsd: row?.cost ?? 0, tokens: row?.tokens ?? 0 };
  });

  const dailyByDay = new Map<string, { counts: Record<StageKey, number>; changes: DayChanges; costUsd: number; labelled?: number }>();
  for (let i = days - 1; i >= 0; i--)
    dailyByDay.set(localDay(now - i * DAY_MS), {
      counts: emptyCounts(),
      changes: { archive: 0, spam: 0, keep: 0 },
      costUsd: 0,
      ...(label === undefined ? {} : { labelled: 0 }),
    });
  const isLabel = label === undefined ? sql<boolean>`false` : sql<boolean>`coalesce(${labelIs(label)}, false)`;
  for (const row of await db.select({ decidedAt: decisions.decidedAt, stage: decisions.stage, labelled: isLabel }).from(decisions).where(triagedSince)) {
    const day = dailyByDay.get(localDay(row.decidedAt));
    if (!day) continue;
    day.counts[row.stage]++;
    if (row.labelled && day.labelled !== undefined) day.labelled++;
  }
  for (const run of runs) {
    const day = dailyByDay.get(localDay(run.startedAt));
    if (day) day.costUsd += run.costUsd;
  }
  // What was done in Gmail each day, once per message, by its latest change that stands, by what it did.
  // Undone ones, and ones that never landed, are not counted.
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
    .where(
      and(
        decidedSince,
        eq(decisions.carryOut, true),
        eq(
          decisions.id,
          db
            .select({ id: max(first.id) })
            .from(first)
            .where(and(eq(first.accountId, decisions.accountId), eq(first.messageId, decisions.messageId), eq(first.carryOut, true))),
        ),
      ),
    )) {
    const day = dailyByDay.get(localDay(row.decidedAt));
    if (!day) continue;
    if (row.status === 'done') {
      const what = row.block ? 'spam' : row.disposition;
      if (what === 'archive' || what === 'spam' || what === 'keep') day.changes[what]++;
    }
  }

  const answered = await accuracy(db, since, scope.accounts);
  const byLabel = Map.groupBy(await keptOutLessDigests(db, scope, since), (row) => row.labelId);
  const names = await labelNames(db);
  const kept = [...byLabel]
    .map(([labelId, rows]) => ({ labelId, labelName: labelId === null ? null : (names.get(labelId) ?? labelId), messages: net(rows) }))
    .filter((row) => row.messages > 0)
    .toSorted((a, b) => b.messages - a.messages);

  return {
    days,
    accounts,
    totals: {
      messages: (
        await db
          .select({ n: count() })
          .from(messages)
          .where(and(gte(messages.receivedAt, since), within(scope, messages.accountId)))
      )[0]!.n,
      decided: triaged.n,
      withoutInference: triaged.free ?? 0,
      ...spent,
      awaitingTriage: (
        await db
          .select({ n: count() })
          .from(messages)
          .where(and(within(scope, messages.accountId), noDecision(db), not(outOfTries(db, messages.accountId, messages.id))))
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
    daily: [...dailyByDay].map(([day, rest]) => ({ day, ...rest })),
    topSenders: (await topSenders(db, scope, since)).map((r) => ({ address: openNewest(db, r.newest).fromAddress, messages: r.n, lastDisposition: r.last })),
    recent: (await listDecisions(db, scope, { days, limit: 10 }, now)).rows,
    saved: {
      ...saved(kept.reduce((sum, row) => sum + row.messages, 0)),
      byLabel: kept,
      unsubscribed: await unsubscribed(db, scope, since),
    },
    accuracy: { ...answered, byStage: STAGE_NAMES.map((stage) => answered.byStage.find((r) => r.stage === stage) ?? { stage, reviewed: 0, right: 0 }) },
  };
}
