import { z } from 'zod';
import { eq, rules } from '../../../store/query.ts';
import { ruleFilterStatus } from '../../../store/filters.ts';
import { type RuleSays, removeRule } from '../../../store/rules.ts';
import { nameAlone, tidyMatch } from '../../../triage/stages/rules.ts';
import { RuleFacts, type RuleMatch } from '../../types.ts';
import { type Context, decided, labelId, redecide, text } from '../route.ts';
import { Refusal } from '../../../refusal.ts';

export const ruleId = text(40);

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

/** A rule as the rule dialog sends it, to add or to change one. */
export const ruleBody = z.strictObject({
  match: conditions,
  label: labelId.optional(),
  whenLabel: labelId.optional(),
  disposition: decided.optional(),
  markRead: z.boolean().optional(),
  unsubscribe: z.boolean().optional(),
  when: z.string().max(200).optional(),
  /** What the user calls it; empty for none, which also takes away the name of a rule this replaces. */
  name: z.string().max(80).optional(),
});

/** What a rule must say, checked on the whole body. */
export const saysEnough = <T extends z.ZodType<z.infer<typeof ruleBody>>>(body: T) =>
  body
    .refine((rule) => rule.label !== undefined || rule.whenLabel !== undefined || rule.disposition !== undefined, {
      message: 'A rule says what mail is, what happens to it, or what happens when it is a given label.',
    })
    .refine((rule) => rule.label === undefined || rule.whenLabel === undefined, {
      path: ['whenLabel'],
      message: 'A rule that says what mail is cannot also wait for a label.',
    });

/** The body's rule, apart from its conditions, as the store takes it. */
export const saysOf = ({ label, whenLabel, disposition, markRead, unsubscribe, when, name }: Omit<z.infer<typeof ruleBody>, 'match'>): RuleSays => ({
  ...(label === undefined ? {} : { labelId: label }),
  ...(whenLabel === undefined ? {} : { whenLabel }),
  ...(disposition ? { disposition } : {}),
  ...(markRead ? { markRead } : {}),
  ...(unsubscribe ? { subscription: 'unsubscribe' as const } : {}),
  ...(when !== undefined && when.trim() !== '' ? { when } : {}),
  name: name ?? null,
});

/**
 * Take out the Gmail filters written for a rule that is about to go, in every mailbox: one left behind would
 * keep acting on mail with no rule to explain or remove it. Asked even with no filter recorded: one Mild wrote
 * and lost track of is found and removed there too. False when there is no such rule.
 */
export async function removeFilter({ db, controls }: Context, id: string): Promise<boolean> {
  const [rule] = await db.select({ id: rules.id }).from(rules).where(eq(rules.id, id));
  if (!rule) return false;
  if (controls) await controls.ruleFilter(db, id, false);
  else if ((await ruleFilterStatus(db)).get(id)?.filterId) throw new Refusal('This rule is also a Gmail filter, which this dashboard cannot remove.');
  return true;
}

/** Remove a rule, and the Gmail filters written for it, then re-decide what is waiting. Returns how many were re-decided. */
export async function removeRuleAndFilter(ctx: Context, id: string): Promise<number> {
  const source = (await removeFilter(ctx, id)) ? await removeRule(ctx.db, id) : null;
  if (source === null) throw new Refusal('That rule no longer exists.');
  return await redecide(ctx, source === 'learned' ? id : undefined);
}
