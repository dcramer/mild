import { z } from 'zod';
import { DRAFT_ACTIONS } from '../../triage/proposal.ts';
import { answered, held } from './parts.ts';

/** A label: what mail is, and what Mild does with it. */
export const LabelSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** What Mild does with it: `keep`, `archive`, `spam`, `block` (spam, and the sender's later mail too) or `digest` (archive, and list it once a day). */
  disposition: z.string(),
  /** Also mark the mail read. Only with `keep` and `archive`. */
  markRead: z.boolean(),
  /** Also leave the sender's mailing list, where that can be done safely. */
  unsubscribe: z.boolean(),
  /** Null for Leave in inbox. */
  gmailLabel: z.string().nullable(),
  /** Rules that say mail is this label. */
  rules: z.number(),
  /** Messages whose current decision carries this label. */
  messages: z.number(),
  /** Of the suggestions for this label the user has answered, how many Mild had right. */
  record: answered,
});
export type LabelSummary = z.infer<typeof LabelSummary>;

/** A label the model suggested from what the person wants. Nothing is made until they accept it. */
const LabelDraft = z.object({
  name: held,
  description: held,
  disposition: z.enum(DRAFT_ACTIONS),
  markRead: z.literal(true).optional(),
  unsubscribe: z.literal(true).optional(),
  /** Which part of what they asked for it serves. */
  why: held,
});

export const LabelProposal = z.object({
  id: z.number(),
  goal: held,
  drafts: z.array(LabelDraft),
  /** What its labels leave out of what was asked, such as what a label they have covers already. */
  note: held.optional(),
  at: z.number(),
});
export type LabelProposal = z.infer<typeof LabelProposal>;
