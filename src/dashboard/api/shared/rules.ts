import { eq, rules } from '../../../store/query.ts';
import { ruleFilterStatus } from '../../../store/filters.ts';
import { removeRule } from '../../../store/rules.ts';
import { type Context, redecide, text } from '../route.ts';
import { Refusal } from '../../../refusal.ts';

export const ruleId = text(40);

/**
 * Take out the Gmail filters written for a rule that is about to go, in every mailbox: one left behind would
 * keep acting on mail with no rule to explain or remove it. Asked even with no filter recorded: one sift wrote
 * and lost track of is found and removed there too. False when there is no such rule.
 */
export async function removeFilter({ db, controls }: Context, id: string): Promise<boolean> {
  const [rule] = await db.select({ id: rules.id }).from(rules).where(eq(rules.id, id));
  if (!rule) return false;
  if (controls) await controls.ruleFilter(db, id, false);
  else if ((await ruleFilterStatus(db)).get(id)?.filterId) throw new Refusal('This rule is also a Gmail filter, which this dashboard cannot remove.');
  return true;
}

/** Remove a rule, and the Gmail filters written for it, then re-decide what is waiting. Returns how many were re-decided. */
export async function removeRuleAndFilter(ctx: Context, id: string): Promise<number> {
  if (!(await removeFilter(ctx, id)) || !(await removeRule(ctx.db, id))) throw new Refusal('That rule no longer exists.');
  return await redecide(ctx.db, ctx.now);
}
