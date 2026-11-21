import { alias, and, count, decisions, eq, feedback, inArray, isNotNull, max, rules as ruleRows, sql } from '../../store/query.ts';
import type { Sql } from '../../store/sql.ts';
import { listLabels } from '../../store/labels.ts';
import { type Scope, within } from '../scope.ts';
import type { LabelSummary } from '../types.ts';

/** What a label does, as the one word the dashboard shows and sets. */
export const outcomeOf = (label: { disposition: string; block?: boolean; digest?: boolean }) =>
  label.block ? 'block' : label.digest ? 'digest' : label.disposition;

/** The person's labels, each with how much depends on it and how often Mild has had it right, over the scope's mailboxes. */
export async function listLabelSummaries(db: Sql, scope: Scope): Promise<LabelSummary[]> {
  if (scope.accounts.length === 0) return [];
  const byLabel = <T extends { id: string | null }>(rows: T[]) => new Map(rows.map((r) => [r.id, r] as const));
  const labelOfRule = sql<string | null>`coalesce(${ruleRows.labelId}, ${ruleRows.whenLabel})`;
  const rules = byLabel(await db.select({ id: labelOfRule, n: count() }).from(ruleRows).where(isNotNull(labelOfRule)).groupBy(labelOfRule));
  const later = alias(decisions, 'later');
  const messages = byLabel(
    await db
      .select({ id: decisions.labelId, n: count() })
      .from(decisions)
      .where(
        and(
          within(scope, decisions.accountId),
          isNotNull(decisions.labelId),
          eq(
            decisions.id,
            db
              .select({ id: max(later.id) })
              .from(later)
              .where(and(eq(later.accountId, decisions.accountId), eq(later.messageId, decisions.messageId))),
          ),
        ),
      )
      .groupBy(decisions.labelId),
  );
  const record = byLabel(
    await db
      .select({ id: decisions.labelId, n: count(), right: sql<number>`count(*) FILTER (WHERE ${feedback.verdict} = 'right')`.mapWith(Number) })
      .from(feedback)
      .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
      .where(and(within(scope, feedback.accountId), inArray(feedback.verdict, ['right', 'wrong']), isNotNull(decisions.labelId)))
      .groupBy(decisions.labelId),
  );
  return (await listLabels(db)).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    disposition: outcomeOf(l),
    markRead: l.markRead ?? false,
    unsubscribe: l.unsubscribe ?? false,
    gmailLabel: l.gmailLabel ?? null,
    rules: rules.get(l.id)?.n ?? 0,
    messages: messages.get(l.id)?.n ?? 0,
    record: { reviewed: record.get(l.id)?.n ?? 0, right: record.get(l.id)?.right ?? 0 },
  }));
}
