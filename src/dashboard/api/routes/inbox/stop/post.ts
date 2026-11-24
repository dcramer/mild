import { z } from 'zod';
import { stopInboxRuns } from '../../../../../store/inbox-runs.ts';
import { done, self, write } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';

export default write({
  path: '/api/inbox/stop',
  // With a rule, stop applying it; without, stop going through the inbox.
  body: z.strictObject({ rule: ruleId.optional() }),
  reply: done,
  touches: self,
  run: async ({ db, now }, { rule }) => {
    await stopInboxRuns(db, rule ?? null, now());
    return { ok: true as const };
  },
});
