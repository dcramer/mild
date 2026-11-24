import { z } from 'zod';
import { Contact, answered, decided, held, heldMatch, labelId, stage, text } from './parts.ts';

/** One sender's mail that is waiting on the user. GET /api/suggestion. */
export const SuggestionDetail = z.object({
  messages: z.array(
    z.object({
      accountId: z.string(),
      decisionId: z.number(),
      messageId: z.string(),
      subject: held,
      receivedAt: z.number(),
      labelId: z.string().nullable(),
    }),
  ),
});
export type SuggestionDetail = z.infer<typeof SuggestionDetail>;

/** What Mild thinks of a message: its current decision, as For review's rows and Inbox's show it. */
export const Thinks = z.object({
  decisionId: z.number(),
  /** What Mild would do. `review` without a label means it could not place the mail. */
  disposition: z.string(),
  /** What Mild says the mail is, or null if it could not place it. */
  labelId: z.string().nullable(),
  labelName: z.string().nullable(),
  /** Which tier decided, and how sure a model was (0 to 1); null when no model was asked. */
  stage,
  confidence: z.number().nullable(),
});

/** One waiting suggestion: what Mild proposes for one message, which the user has not answered. */
export const SuggestionItem = z.object({
  accountId: z.string(),
  messageId: z.string(),
  sender: held,
  senderName: held.nullable(),
  contact: Contact,
  subject: held,
  receivedAt: z.number(),
  ...Thinks.shape,
  /**
   * What else it might be, most likely first: the labels the sender's other mail has had, with the share
   * of it each had. Until the model ranks its own guesses, this is the best second opinion Mild holds.
   */
  alternatives: z.array(z.object({ id: z.string(), name: z.string(), share: z.number() })),
  /** The start of the message's text, on one line, where Mild holds it: enough to tell what it is without opening it. */
  preview: held.nullable(),
});
export type SuggestionItem = z.infer<typeof SuggestionItem>;

/** A rule Mild thinks is worth having, for the user to accept or dismiss. */
const ProposalSummary = z.object({
  id: z.number(),
  accountId: z.string(),
  match: heldMatch,
  labelId: z.string(),
  labelName: z.string(),
  /** What the user has been doing to the label's mail, which the rule would do. */
  disposition: z.string(),
  /** What the label does. */
  labelDisposition: z.string(),
  /** How many decisions in a row it rests on. */
  agreed: z.number(),
});
type ProposalSummary = z.infer<typeof ProposalSummary>;

export const Suggestions = z.object({
  /** Newest first. */
  items: z.array(SuggestionItem),
  proposals: z.array(ProposalSummary),
  /** Messages waiting, which can be more than `items` holds. */
  waiting: z.number(),
  /** From the user's answers so far. */
  accuracy: answered,
  /** The labels the user can say something is, with what Mild does for each. */
  labels: z.array(z.object({ id: z.string(), name: z.string(), disposition: z.string() })),
  /** Whether Mild is on for the viewer. Off, nothing listed has been done in Gmail. */
  active: z.boolean(),
  /** Mild is going through the inbox, or mail it found there waits for the model: more suggestions are coming. */
  importing: z.boolean(),
});
export type Suggestions = z.infer<typeof Suggestions>;

/** The body of POST /api/feedback: what one message is. It makes no rule; only the rule dialog does. */
export const FeedbackRequest = z.strictObject({
  accountId: z.string(),
  sender: z.string(),
  label: labelId,
  /** What should happen to it. Left out: what the label does. */
  disposition: decided.optional(),
  /** False: recorded, and the mail left where it is (Inbox, where the reader archives it themselves). Left out: done in Gmail. */
  carryOut: z.boolean().optional(),
  decisionId: z.int().optional(),
  /** The one message the answer is about, which need not be waiting: this is how a decision already made is corrected. */
  messageId: text(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequest>;

/** What POST /api/feedback answers. */
export const FeedbackReply = z.object({
  /** Why Mild's own change to the corrected message could not be taken back in Gmail. The answer is saved either way. */
  notFixed: z.string().nullable(),
});
export type FeedbackReply = z.infer<typeof FeedbackReply>;
