import { z } from 'zod';
import { eq, rules } from '../../../../../store/query.ts';
import { RuleApplied } from '../../../../types.ts';
import { ownerOf, text, write } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';
import { Refusal } from '../../../../../refusal.ts';

export default write({
  path: '/api/rules/apply',
  body: z.strictObject({ id: ruleId, messageIds: z.array(text()).min(1).max(300) }),
  reply: RuleApplied,
  touches: ownerOf(rules),
  run: async ({ db, controls }, { id, messageIds }) => {
    const [rule] = await db.select({ id: rules.id }).from(rules).where(eq(rules.id, id));
    if (!rule) return null;
    if (!controls) throw new Refusal('This dashboard cannot change Gmail.');
    return await controls.applyRule(db, id, messageIds);
  },
});
