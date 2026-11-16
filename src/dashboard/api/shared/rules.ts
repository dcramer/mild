import { getRuleFilter } from '../../../store/filters.ts';
import { removeRule } from '../../../store/rules.ts';
import { type Context, redecide, text } from '../route.ts';

export const ruleId = text(40);

/** Remove a rule, and the Gmail filter written for it, then re-decide what is waiting. Returns how many were re-decided. */
export async function removeRuleAndFilter({ db, controls, now }: Context, id: string): Promise<number> {
  const rule = await getRuleFilter(db, id);
  if (!rule) throw new Error('That rule no longer exists.');
  // A filter left behind would keep acting on mail with no rule to explain or remove it. Asked even
  // with no filter recorded: one sift wrote and lost track of is found and removed there too.
  if (controls) await controls.ruleFilter(db, id, false);
  else if (rule.filterId) throw new Error('This rule is also a Gmail filter, which this dashboard cannot remove.');
  if (!(await removeRule(db, id))) throw new Error('That rule no longer exists.');
  return await redecide(db, now, rule.accountId);
}
