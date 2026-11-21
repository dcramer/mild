import { z } from 'zod';
import { ruleFilterStatus } from '../../../../store/filters.ts';
import { preferences } from '../../../../store/preferences.ts';
import { madeFromProposal } from '../../../../store/proposals.ts';
import { listRules, setRule } from '../../../../store/rules.ts';
import { RuleFilter } from '../../../types.ts';
import { id, redecide, self, write } from '../../route.ts';
import { ruleBody, saysEnough, saysOf } from '../../shared/rules.ts';
import { Refusal } from '../../../../refusal.ts';

export default write({
  path: '/api/rules',
  body: saysEnough(
    ruleBody.extend({
      /** The proposal this rule was made from, as the user left it. */
      proposal: id.optional(),
    }),
  ),
  /**
   * `replaced`: a rule with exactly these conditions was there and now says this, so removing it would not put things back.
   * `filter`: the Gmail filter the rule can also be, to offer next; null when it cannot be one, already has one, or Mild is off.
   */
  reply: z.object({ id: z.string(), replaced: z.boolean(), redecided: z.number(), filter: RuleFilter.nullable() }),
  touches: self,
  run: async (ctx, { match, proposal, ...rule }) => {
    const { db, now } = ctx;
    const { created, replaced } = await db.transaction(async (tx) => {
      // First: making the rule also settles any proposal for exactly that mail.
      if (proposal !== undefined && !(await madeFromProposal(tx, proposal, now()))) throw new Refusal('That proposal is no longer open.');
      const before = new Set((await listRules(tx)).map((r) => r.id));
      // A rule with exactly these conditions is replaced; the dialog shows which.
      const id = await setRule(tx, match, saysOf(rule), 'user', now());
      return { created: id, replaced: before.has(id) };
    });
    const redecided = await redecide(ctx);
    const filter = (await ruleFilterStatus(db)).get(created);
    const offer = filter?.possible && !filter.filterId && (await preferences(db)).active;
    return { id: created, replaced, redecided, filter: offer ? filter : null };
  },
});
