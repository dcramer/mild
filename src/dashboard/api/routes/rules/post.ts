import { z } from 'zod';
import { getRuleFilter, ruleFilterStatus } from '../../../../store/filters.ts';
import { preferences } from '../../../../store/preferences.ts';
import { madeFromProposal } from '../../../../store/proposals.ts';
import { listRules, setRule } from '../../../../store/rules.ts';
import { nameAlone, tidyMatch } from '../../../../triage/stages/rules.ts';

import { RuleFacts, RuleFilter, type RuleMatch } from '../../../types.ts';
import { accountId, decided, id, labelId, named, redecide, write } from '../../route.ts';
import { Refusal } from '../../../../refusal.ts';

/** More alternatives than this for one condition is a list of senders to keep somewhere else. */
const values = z.array(z.string().max(200)).max(50).optional();

/** A value left empty is not one, nor a condition with none. */
const conditions = z
  .strictObject({
    from: values,
    fromDomain: values,
    fromName: values,
    fromNameContains: values,
    to: values,
    listId: values,
    subjectContains: values,
    facts: RuleFacts.optional(),
  })
  .transform((given): RuleMatch => tidyMatch(given))
  .refine((match) => Object.keys(match).length > 0, 'A rule needs at least one condition.')
  .refine((match) => !nameAlone(match), 'Anyone can send mail under any name: give the sender’s address or domain as well.');

export default write({
  path: '/api/rules',
  body: z
    .strictObject({
      accountId,
      match: conditions,
      label: labelId.optional(),
      whenLabel: labelId.optional(),
      disposition: decided.optional(),
      markRead: z.boolean().optional(),
      unsubscribe: z.boolean().optional(),
      when: z.string().max(200).optional(),
      /** What the user calls it; empty for none, which also takes away the name of a rule this replaces. */
      name: z.string().max(80).optional(),
      /** The proposal this rule was made from, as the user left it. */
      proposal: id.optional(),
    })
    .refine((rule) => rule.label !== undefined || rule.whenLabel !== undefined || rule.disposition !== undefined, {
      message: 'A rule says what mail is, what happens to it, or what happens when it is a given label.',
    })
    .refine((rule) => rule.label === undefined || rule.whenLabel === undefined, {
      path: ['whenLabel'],
      message: 'A rule that says what mail is cannot also wait for a label.',
    }),
  /**
   * `replaced`: a rule with exactly these conditions was there and now says this, so removing it would not put things back.
   * `filter`: the Gmail filter the rule can also be, to offer next; null when it cannot be one, already has one, or Sift is off.
   */
  reply: z.object({ id: z.string(), replaced: z.boolean(), redecided: z.number(), filter: RuleFilter.nullable() }),
  touches: named,
  run: async ({ db, now }, { accountId, match, label, whenLabel, disposition, markRead, unsubscribe, when, name, proposal }) => {
    const { created, replaced } = await db.transaction(async (tx) => {
      // First: making the rule also settles any proposal for exactly that mail.
      if (proposal !== undefined && !(await madeFromProposal(tx, proposal, accountId, now()))) throw new Refusal('That proposal is no longer open.');
      const before = new Set((await listRules(tx, accountId)).map((r) => r.id));
      // A rule with exactly these conditions is replaced; the dialog shows which.
      const id = await setRule(
        tx,
        accountId,
        match,
        {
          ...(label === undefined ? {} : { labelId: label }),
          ...(whenLabel === undefined ? {} : { whenLabel }),
          ...(disposition ? { disposition } : {}),
          ...(markRead ? { markRead } : {}),
          ...(unsubscribe ? { subscription: 'unsubscribe' as const } : {}),
          ...(when !== undefined && when.trim() !== '' ? { when } : {}),
          name: name ?? null,
        },
        'user',
        now(),
      );
      return { created: id, replaced: before.has(id) };
    });
    const redecided = await redecide(db, now, accountId);
    const filter = (await ruleFilterStatus(db)).get(created);
    const offer = filter?.possible && !(await getRuleFilter(db, created))?.filterId && (await preferences(db)).active;
    return { id: created, replaced, redecided, filter: offer ? filter : null };
  },
});
