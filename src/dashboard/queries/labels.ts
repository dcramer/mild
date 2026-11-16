import type { Sql } from '../../store/sql.ts';
import { listLabels } from '../../store/labels.ts';
import { type Scope, sees } from '../scope.ts';
import type { LabelSummary } from '../types.ts';

/** What a label does, as the one word the dashboard shows and sets. */
export const outcomeOf = (label: { disposition: string; block?: boolean }) => (label.block ? 'block' : label.disposition);

/** An account's labels, each with how much depends on it and how often sift has had it right. */
export async function listLabelSummaries(db: Sql, scope: Scope, accountId: string): Promise<LabelSummary[]> {
  if (!sees(scope, accountId)) return [];
  const counts = async (sql: string) => new Map((await db.all<{ id: string; n: number; right?: number }>(sql, accountId)).map((r) => [r.id, r] as const));
  const rules = await counts(
    'SELECT coalesce(label_id, when_label) AS id, count(*) AS n FROM rules WHERE account_id = ? AND coalesce(label_id, when_label) IS NOT NULL GROUP BY 1',
  );
  const messages = await counts(
    `SELECT d.label_id AS id, count(*) AS n FROM decisions d
     WHERE d.account_id = ? AND d.label_id IS NOT NULL
       AND d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
     GROUP BY d.label_id`,
  );
  const record = await counts(
    `SELECT d.label_id AS id, count(*) AS n, sum(f.verdict = 'right') AS right FROM feedback f JOIN decisions d ON d.id = f.decision_id
     WHERE f.account_id = ? AND f.verdict IN ('right', 'wrong') AND d.label_id IS NOT NULL GROUP BY d.label_id`,
  );
  return (await listLabels(db, accountId)).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    disposition: outcomeOf(l),
    markRead: l.markRead ?? false,
    unsubscribe: l.unsubscribe ?? false,
    gmailLabel: l.gmailLabel,
    rules: rules.get(l.id)?.n ?? 0,
    messages: messages.get(l.id)?.n ?? 0,
    record: { reviewed: record.get(l.id)?.n ?? 0, right: record.get(l.id)?.right ?? 0 },
  }));
}
