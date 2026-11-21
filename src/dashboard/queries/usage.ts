import { and, gte, modelRuns } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { type Scope, within } from '../scope.ts';
import type { Usage } from '../types.ts';
import { DAY_MS } from './decisions.ts';
import { localDay } from './summary.ts';
import { keptOutLessDigests, net, saved, wouldKeepOut } from './saved.ts';

/** Days the masthead's cost and each rule's cover. */
export const MONTH = 30;

/**
 * What the viewer's model calls cost, failed ones included, and what Mild took out of their inbox: over the last day,
 * week and 30 days, and per day for those 30.
 */
export async function usage(db: Sql, scope: Scope, now: number): Promise<Usage> {
  const runs = await db
    .select({ startedAt: modelRuns.startedAt, costUsd: modelRuns.costUsd })
    .from(modelRuns)
    .where(and(gte(modelRuns.startedAt, now - MONTH * DAY_MS), within(scope, modelRuns.accountId)));
  const since = (days: number) => runs.filter((r) => r.startedAt >= now - days * DAY_MS).reduce((sum, r) => sum + r.costUsd, 0);
  const daily = new Map<string, number>();
  for (let i = MONTH - 1; i >= 0; i--) daily.set(localDay(now - i * DAY_MS), 0);
  for (const run of runs) {
    const day = localDay(run.startedAt);
    const sum = daily.get(day);
    if (sum !== undefined) daily.set(day, sum + run.costUsd);
  }
  const kept = await keptOutLessDigests(db, scope, now - MONTH * DAY_MS);
  const keptSince = (days: number) => saved(net(kept.filter((k) => k.at >= now - days * DAY_MS)));
  const keptDaily = Map.groupBy(kept, (k) => localDay(k.at));
  return {
    day: since(1),
    week: since(7),
    month: since(MONTH),
    daily: [...daily.values()],
    saved: {
      day: keptSince(1),
      week: keptSince(7),
      month: keptSince(MONTH),
      daily: [...daily.keys()].map((day) => saved(net(keptDaily.get(day) ?? [])).seconds),
      wouldHave: saved(await wouldKeepOut(db, scope, now - MONTH * DAY_MS)),
    },
  };
}
