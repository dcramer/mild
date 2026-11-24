import { z } from 'zod';
import { eq, rules } from '../../../../../store/query.ts';
import { listAccounts } from '../../../../../store/accounts.ts';
import { REACH, startInboxRuns } from '../../../../../store/inbox-runs.ts';
import { hasOwnLabels } from '../../../../../store/labels.ts';
import { done, self, write } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';
import { Refusal } from '../../../../../refusal.ts';

/** Apply a rule to every inbox of the person's, as their press: a run each that goes on a slice per tick, Mild on or off. */
export default write({
  path: '/api/rules/apply',
  body: z.strictObject({ id: ruleId }),
  reply: done,
  touches: self,
  run: async ({ db, controls, now }, { id }) => {
    const [rule] = await db.select({ id: rules.id }).from(rules).where(eq(rules.id, id));
    if (!rule) return null;
    // A run is only gone on with where Mild reads.
    if (!(await hasOwnLabels(db))) throw new Refusal('Mild reads nothing from your inbox until you have a label of your own.');
    const mailboxes = (await listAccounts(db)).map((a) => a.id);
    if ((await startInboxRuns(db, mailboxes, { acts: true, most: REACH.inbox, now: now(), ruleId: id })) === 0)
      throw new Refusal('Mild is already applying this rule.');
    await controls?.checkNow(db);
    return { ok: true as const };
  },
});
