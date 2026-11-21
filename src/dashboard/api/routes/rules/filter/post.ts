import { z } from 'zod';
import { ruleFilterStatus } from '../../../../../store/filters.ts';
import { preferences } from '../../../../../store/preferences.ts';
import { RuleFilter } from '../../../../types.ts';
import { self, write } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';
import { Refusal } from '../../../../../refusal.ts';

/** Write a rule to Gmail as a filter in every mailbox of the person's, or take it out of them all. */
export default write({
  path: '/api/rules/filter',
  body: z.strictObject({ id: ruleId, on: z.boolean() }),
  reply: z.object({ filterId: z.string().nullable(), filter: RuleFilter.nullable() }),
  touches: self,
  run: async ({ db, controls }, { id, on }) => {
    if (!controls) throw new Refusal('This dashboard cannot change Gmail filters.');
    // Taking a filter out is always allowed: it only reduces what runs unattended.
    if (on && !(await preferences(db)).active) throw new Refusal('Mild is off, so it writes nothing to Gmail. Turn it on first, in Settings.');
    await controls.ruleFilter(db, id, on);
    const filter = (await ruleFilterStatus(db)).get(id);
    return { filterId: filter?.filterId ?? null, filter: filter ?? null };
  },
});
