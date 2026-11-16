import { z } from 'zod';
import { getRuleFilter, ruleFilterStatus } from '../../store/filters.ts';
import { preferences } from '../../store/preferences.ts';
import { addRule, removeRule } from '../../store/rules.ts';
import { listRuleSummaries } from '../queries/rules.ts';
import { rules } from '../../store/query.ts';
import { RuleFacts, RuleFilter, type RuleMatch, RuleSummary } from '../types.ts';
import { type Read, type Write, accountId, decided, labelId, named, ok, ownerOf, read, redecide, text, write } from './route.ts';

const value = z.string().max(200).optional();
/** A condition left empty is not one. */
const conditions = z
  .strictObject({ from: value, fromDomain: value, to: value, listId: value, subjectContains: value, facts: RuleFacts.optional() })
  .transform(({ facts, ...rest }): RuleMatch => {
    const given = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined && value !== ''));
    return facts && Object.keys(facts).length > 0 ? { ...given, facts } : given;
  })
  .refine((match) => Object.keys(match).length > 0, 'A rule needs at least one condition.');

const ruleId = text(40);

export const reads: Read[] = [
  read({
    path: '/api/rules',
    query: z.object({}),
    reply: z.object({ rules: z.array(RuleSummary) }),
    run: async ({ db }, scope) => ok({ rules: await listRuleSummaries(db, scope) }),
  }),
];

export const writes: Write[] = [
  write({
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
    run: async ({ db, now }, { accountId, match, label, whenLabel, disposition, markRead, unsubscribe, when }) => {
      const id = await addRule(
        db,
        accountId,
        {
          match,
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
      return { id, redecided: await redecide(db, now, accountId) };
    },
  }),
  write({
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
  }),
  write({
    path: '/api/rules/remove',
    body: z.strictObject({ id: ruleId }),
    reply: z.object({ ok: z.literal(true), redecided: z.number() }),
    touches: ownerOf(rules),
    run: async ({ db, controls, now }, { id }) => {
      const rule = await getRuleFilter(db, id);
      if (!rule) throw new Error('That rule no longer exists.');
      // A filter left behind would keep acting on mail with no rule to explain or remove it. Asked even
      // with no filter recorded: one sift wrote and lost track of is found and removed there too.
      if (controls) await controls.ruleFilter(db, id, false);
      else if (rule.filterId) throw new Error('This rule is also a Gmail filter, which this dashboard cannot remove.');
      if (!(await removeRule(db, id))) throw new Error('That rule no longer exists.');
      return { ok: true as const, redecided: await redecide(db, now, rule.accountId) };
    },
  }),
];
