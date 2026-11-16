import { z } from 'zod';
import { getRuleFilter, ruleFilterStatus } from '../../../../../store/filters.ts';
import { preferences } from '../../../../../store/preferences.ts';
import { rules } from '../../../../../store/query.ts';
import { RuleFilter } from '../../../../types.ts';
import { ownerOf, write } from '../../../route.ts';
import { ruleId } from '../../../shared/rules.ts';

export default write({
  path: '/api/rules/filter',
  body: z.strictObject({ id: ruleId, on: z.boolean() }),
  reply: z.object({ filterId: z.string().nullable(), filter: RuleFilter.nullable() }),
  touches: ownerOf(rules),
  run: async ({ db, controls }, { id, on }) => {
    if (!controls) throw new Error('This dashboard cannot change Gmail filters.');
    // Taking a filter out is always allowed: it only reduces what runs unattended.
    if (on && !(await preferences(db)).active) throw new Error('sift is off, so it writes nothing to Gmail. Turn it on first, in Settings.');
    await controls.ruleFilter(db, id, on);
    return { filterId: (await getRuleFilter(db, id))?.filterId ?? null, filter: (await ruleFilterStatus(db)).get(id) ?? null };
  },
});
