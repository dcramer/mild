import { z } from 'zod';
import { listRuleSummaries } from '../../../queries/rules.ts';

import { RuleSummary } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({
  path: '/api/rules',
  query: z.object({}),
  reply: z.object({ rules: z.array(RuleSummary) }),
  run: async ({ db, now }, scope) => ok({ rules: await listRuleSummaries(db, scope, now()) }),
});
