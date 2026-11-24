import { z } from 'zod';
import type { Confidential } from '../../confidential.ts';
import { RULE_FACTS, type RuleFacts as Conditions, factCondition } from '../../triage/facts.ts';
import { GIVEN } from '../../triage/standing.ts';
import { DECIDED, STAGE_NAMES, type StageName } from '../../triage/types.ts';
import { CONTACTS } from '../../store/states.ts';

export type StageKey = StageName;
export const stage = z.enum(STAGE_NAMES);

const LABEL_ID = /^[a-z0-9_-]{1,40}$/;
/** Text a person typed or the page sent, not empty and not long. */
export const text = (max = 200) => z.string().min(1).max(max);
export const labelId = z.string().regex(LABEL_ID);
export const decided = z.enum(DECIDED);
export const ruleKind = z.enum(['label', 'action', 'when-label']);
/** A rule's conditions on facts: each fact named once, with one of the answers `RULE_FACTS` gives it. */
export const RuleFacts = z.strictObject(
  Object.fromEntries(
    Object.keys(RULE_FACTS).map((key) => [
      key,
      z
        .unknown()
        .refine((want) => factCondition(key, want) !== null, { error: `is not an answer Mild has for ${key}` })
        .optional(),
    ]),
  ),
) as unknown as z.ZodType<Conditions>;
export type RuleFacts = Conditions;
/** Text Mild stores encrypted: what came from mail, what names a sender, and the person's words to the models. */
export const held = z.custom<Confidential>((value) => typeof value === 'string', { error: 'is not text' });
const values = z.array(z.string()).optional();
const match = z.object({
  from: values,
  fromDomain: values,
  fromName: values,
  fromNameContains: values,
  to: values,
  listId: values,
  subjectContains: values,
  facts: RuleFacts.optional(),
});
export type RuleMatch = z.infer<typeof match>;
export const heldValues = z.array(held).optional();
/** A rule's conditions as a reply carries them. Its facts are Mild's own words for what it checked. */
export const heldMatch = z.object({
  from: heldValues,
  fromDomain: heldValues,
  fromName: heldValues,
  fromNameContains: heldValues,
  to: heldValues,
  listId: heldValues,
  subjectContains: heldValues,
  facts: RuleFacts.optional(),
});

/** The facts For review and Activity can be narrowed by (`?fact=`), each a condition on what Mild recorded about the message. */
export const FACT_FILTERS = {
  reply: { isReply: true },
  list: { listId: true },
  'one-click': { unsubscribe: 'one-click' },
  'bulk-service': { bulkService: true },
  'not-to-you': { addressed: 'neither' },
  unproven: { dmarc: ['fail', 'none'] },
  attachments: { hasAttachments: true },
} as const satisfies Record<string, Conditions>;
export type FactFilter = keyof typeof FACT_FILTERS;
export const FACT_FILTER_KEYS = Object.keys(FACT_FILTERS) as FactFilter[];
export const answered = z.object({ reviewed: z.number(), right: z.number() });

/** How the owner and a sender know each other (`contactOf`, src/store/senders.ts). Null for everyone in between. */
export const Contact = z.enum(CONTACTS).nullable();
export type Contact = z.infer<typeof Contact>;

/** Mail Mild took out of the inbox, and the seconds that saved the reader (`saved`, src/dashboard/queries/saved.ts). */
export const Saved = z.object({ messages: z.number(), seconds: z.number() });
export type Saved = z.infer<typeof Saved>;

/** A standing the owner gives a sender or domain: a rule for exactly them that says only what happens to their mail. */
export const Given = z.enum(GIVEN);
export type Given = z.infer<typeof Given>;

export const address = z.object({ address: held, name: held.optional() });
