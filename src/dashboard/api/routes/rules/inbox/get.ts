import { z } from 'zod';
import { eq, rules } from '../../../../../store/query.ts';
import { RuleInbox } from '../../../../types.ts';
import { missing, ok, read } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';
import { Refusal } from '../../../../../refusal.ts';

export default read({
  path: '/api/rules/inbox',
  query: z.object({ id: ruleId }),
  reply: RuleInbox,
  run: async ({ db, controls }, scope, { id }) => {
    const [rule] = await db.select({ id: rules.id }).from(rules).where(eq(rules.id, id));
    if (!rule || scope.accounts.length === 0) return missing('That rule no longer exists.');
    if (!controls) throw new Refusal('This dashboard cannot read Gmail.');
    return ok(await controls.ruleInbox(db, id));
  },
});
