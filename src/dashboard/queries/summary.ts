import type { Sql } from '../../store/sql.ts';
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
  const mine = (column: string) => within(scope, column);
  const one = async <T>(sql: string, ...params: (string | number)[]) => (await db.get<T>(sql, ...params))!;
  const all = async <T>(sql: string, ...params: (string | number)[]) => await db.all<T>(sql, ...params);

  const accounts = await all<{ email: string; last_synced_at: number | null }>(
    `SELECT id AS email, last_synced_at FROM mailboxes WHERE ${mine('id')} ORDER BY id`,
  );
  const decisionTotals = await one<{ n: number; free: number | null; cost: number | null }>(
    `SELECT count(*) AS n, sum(model IS NULL) AS free, sum(cost_usd) AS cost FROM decisions WHERE decided_at >= ? AND ${mine('account_id')}`,
    since,
  );

  const stageRows = await all<{ stage: StageKey; n: number; cost: number; tokens: number }>(
    `SELECT stage, count(*) AS n, sum(cost_usd) AS cost, sum(input_tokens + output_tokens) AS tokens
     FROM decisions WHERE decided_at >= ? AND ${mine('account_id')} GROUP BY stage`,
    since,
  );
  const byStage = STAGES.map((stage) => {
    const row = stageRows.find((r) => r.stage === stage);
    return { stage, decisions: row?.n ?? 0, costUsd: row?.cost ?? 0, tokens: row?.tokens ?? 0 };
  });

  const dailyByDay = new Map<string, { counts: Record<StageKey, number>; changes: DayChanges; costUsd: number }>();
  for (let i = days - 1; i >= 0; i--)
    dailyByDay.set(localDay(now - i * DAY_MS), { counts: emptyCounts(), changes: { archive: 0, spam: 0, keep: 0, failed: 0 }, costUsd: 0 });
  for (const row of await all<{ decided_at: number; stage: StageKey; cost_usd: number }>(
    `SELECT decided_at, stage, cost_usd FROM decisions WHERE decided_at >= ? AND ${mine('account_id')}`,
    since,
  )) {
    const day = dailyByDay.get(localDay(row.decided_at));
    if (!day) continue;
    if (row.stage in day.counts) day.counts[row.stage]++;
    day.costUsd += row.cost_usd;
  }
  // What was done in Gmail each day: a change that stands, by what it did, or one that failed. Undone ones are not counted.
  for (const row of await all<{ decided_at: number; disposition: string; block: number; outcome: string | null; status: string | null }>(
    `SELECT d.decided_at, d.disposition, d.block, d.outcome, a.status FROM decisions d
     LEFT JOIN actions a ON a.id = (SELECT max(id) FROM actions WHERE decision_id = d.id AND type != 'unsubscribe')
     WHERE d.decided_at >= ? AND d.mode = 'act' AND ${mine('d.account_id')}`,
    since,
  )) {
    const day = dailyByDay.get(localDay(row.decided_at));
    if (!day) continue;
    if (row.outcome === 'failed' || row.outcome === 'unknown' || row.status === 'failed' || row.status === 'unknown') day.changes.failed++;
    else if (row.status === 'done') {
      const what = row.block === 1 ? 'spam' : row.disposition;
      if (what === 'archive' || what === 'spam' || what === 'keep') day.changes[what]++;
    }
  }

  const answered = await accuracy(db, since, scope.accounts);

  return {
    days,
    generatedAt: now,
    accounts: accounts.map((a) => ({ email: a.email, lastSyncedAt: a.last_synced_at })),
    totals: {
      messages: (await one<{ n: number }>(`SELECT count(*) AS n FROM messages WHERE received_at >= ? AND ${mine('account_id')}`, since)).n,
      decisions: decisionTotals.n,
      withoutInference: decisionTotals.free ?? 0,
      costUsd: decisionTotals.cost ?? 0,
      awaitingTriage: (
        await one<{ n: number }>(
          `SELECT count(*) AS n FROM messages m
         WHERE ${mine('m.account_id')} AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.account_id = m.account_id AND d.message_id = m.id)`,
        )
      ).n,
      troubledActions: (
        await one<{ n: number }>(
          `SELECT count(*) AS n FROM actions WHERE created_at >= ? AND status IN ('failed', 'unknown', 'pending') AND ${mine('account_id')}`,
          since,
        )
      ).n,
    },
    byStage,
    byDisposition: (
      await all<{ disposition: string; n: number }>(
        `SELECT disposition, count(*) AS n FROM decisions WHERE decided_at >= ? AND ${mine('account_id')} GROUP BY disposition ORDER BY n DESC`,
        since,
      )
    ).map((r) => ({ disposition: r.disposition, decisions: r.n })),
    daily: [...dailyByDay].map(([day, { counts, changes, costUsd }]) => ({ day, counts, changes, costUsd })),
    topSenders: (
      await all<{ address: string; n: number; last: string | null }>(
        `SELECT m.from_address AS address, count(*) AS n,
              (SELECT d.disposition FROM decisions d JOIN messages m2 ON m2.account_id = d.account_id AND m2.id = d.message_id
               WHERE m2.from_address = m.from_address AND ${mine('d.account_id')} ORDER BY d.id DESC LIMIT 1) AS last
       FROM messages m WHERE m.received_at >= ? AND ${mine('m.account_id')} GROUP BY m.from_address ORDER BY n DESC, address LIMIT 10`,
        since,
      )
    ).map((r) => ({ address: r.address, messages: r.n, lastDisposition: r.last })),
    recent: (await listDecisions(db, scope, { days, limit: 10 }, now)).rows,
    accuracy: { ...answered, byStage: STAGES.map((stage) => answered.byStage.find((r) => r.stage === stage) ?? { stage, reviewed: 0, right: 0 }) },
  };
}
