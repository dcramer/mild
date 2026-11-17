import { z } from 'zod';
import { ruleUsage } from '../../../../queries/rules.ts';
import { RuleUsage } from '../../../../types.ts';
import { ok, read } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';

export default read({
  path: '/api/rules/usage',
  query: z.object({ id: ruleId }),
  reply: RuleUsage,
  run: async ({ db, now }, scope, { id }) => ok(await ruleUsage(db, scope, id, now())),
});
