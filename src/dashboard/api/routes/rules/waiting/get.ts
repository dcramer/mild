import { z } from 'zod';
import { ruleWaiting } from '../../../../queries/rules.ts';
import { RuleWaiting } from '../../../../types.ts';
import { ok, read } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';

export default read({
  path: '/api/rules/waiting',
  query: z.object({ id: ruleId }),
  reply: RuleWaiting,
  run: async ({ db }, scope, { id }) => ok(await ruleWaiting(db, scope, id)),
});
