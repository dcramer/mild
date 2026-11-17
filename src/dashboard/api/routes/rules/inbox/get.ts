import { z } from 'zod';
import { eq, rules } from '../../../../../store/query.ts';
import { sees } from '../../../../scope.ts';
import { RuleInbox } from '../../../../types.ts';
import { missing, ok, read } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';

export default read({
  path: '/api/rules/inbox',
  query: z.object({ id: ruleId }),
  reply: RuleInbox,
  run: async ({ db, controls }, scope, { id }) => {
    const [rule] = await db.select({ accountId: rules.accountId }).from(rules).where(eq(rules.id, id));
    if (!rule || !sees(scope, rule.accountId)) return missing('That rule no longer exists.');
    if (!controls) throw new Error('This dashboard cannot read Gmail.');
    return ok(await controls.ruleInbox(db, id));
  },
});
