import { getRuleFilter } from '../../../store/filters.ts';
import { removeRule } from '../../../store/rules.ts';
import { type Context, redecide, text } from '../route.ts';
import { Refusal } from '../../../refusal.ts';

export const ruleId = text(40);

/**
 * Take out the Gmail filter written for a rule that is about to go: one left behind would keep acting on
 * mail with no rule to explain or remove it. Asked even with no filter recorded: one sift wrote and lost
 * track of is found and removed there too. Returns the rule's mailbox, or null when there is no such rule.
 */
export async function removeFilter({ db, controls }: Context, id: string): Promise<string | null> {
  const rule = await getRuleFilter(db, id);
  if (!rule) return null;
  if (controls) await controls.ruleFilter(db, id, false);
  else if (rule.filterId) throw new Refusal('This rule is also a Gmail filter, which this dashboard cannot remove.');
  return rule.accountId;
}

/** Remove a rule, and the Gmail filter written for it, then re-decide what is waiting. Returns how many were re-decided. */
export async function removeRuleAndFilter(ctx: Context, id: string): Promise<number> {
  const accountId = await removeFilter(ctx, id);
  if (!accountId || !(await removeRule(ctx.db, id))) throw new Refusal('That rule no longer exists.');
  return await redecide(ctx.db, ctx.now, accountId);
}
