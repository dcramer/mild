import { z } from 'zod';
import { madeFromProposal } from '../../../../store/proposals.ts';
import { setRule } from '../../../../store/rules.ts';

import { RuleFacts, type RuleMatch } from '../../../types.ts';
import { accountId, decided, id, labelId, named, redecide, write } from '../../route.ts';

const value = z.string().max(200).optional();

/** A condition left empty is not one. */
const conditions = z
  .strictObject({ from: value, fromDomain: value, to: value, listId: value, subjectContains: value, facts: RuleFacts.optional() })
  .transform(({ facts, ...rest }): RuleMatch => {
    const given = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined && value !== ''));
    return facts && Object.keys(facts).length > 0 ? { ...given, facts } : given;
  })
  .refine((match) => Object.keys(match).length > 0, 'A rule needs at least one condition.');

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
  reply: z.object({ id: z.string(), redecided: z.number() }),
  touches: named,
  run: async ({ db, now }, { accountId, match, label, whenLabel, disposition, markRead, unsubscribe, when, proposal }) => {
    const created = await db.transaction(async (tx) => {
      // First: making the rule also settles any proposal for exactly that mail.
      if (proposal !== undefined && !(await madeFromProposal(tx, proposal, accountId, now()))) throw new Error('That proposal is no longer open.');
      // A rule with exactly these conditions is replaced; the dialog shows which.
      return await setRule(
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
        },
        'user',
        now(),
      );
    });
    return { id: created, redecided: await redecide(db, now, accountId) };
  },
});
