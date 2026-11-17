import { z } from 'zod';
import { eq, rules } from '../../../../../store/query.ts';
import { REACH, startInboxRuns } from '../../../../../store/inbox.ts';
import { hasOwnLabels } from '../../../../../store/labels.ts';
import { done, ownerOf, write } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';
import { Refusal } from '../../../../../refusal.ts';

/** Apply a rule to its mailbox's inbox, as the user's press: a run that goes on a slice per tick, Sift on or off. */
export default write({
  path: '/api/rules/apply',
  body: z.strictObject({ id: ruleId }),
  reply: done,
  touches: ownerOf(rules),
  run: async ({ db, controls, now }, { id }) => {
    const [rule] = await db.select({ accountId: rules.accountId }).from(rules).where(eq(rules.id, id));
    if (!rule) return null;
    // A run is only gone on with in a mailbox Sift reads.
    if (!(await hasOwnLabels(db, rule.accountId))) throw new Refusal('Sift reads nothing from this inbox until it has a label of your own.');
    if ((await startInboxRuns(db, [rule.accountId], { acts: true, most: REACH.inbox, now: now(), ruleId: id })) === 0)
      throw new Refusal('Sift is already applying this rule.');
    await controls?.checkNow(db);
    return { ok: true as const };
  },
});
