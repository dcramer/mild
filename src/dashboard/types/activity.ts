import { z } from 'zod';
import { Contact, Saved, held, stage } from './parts.ts';

/** What was done in Gmail on a day: changes that stand, by what they did. */
export const DayChanges = z.object({
  archive: z.number(),
  spam: z.number(),
  keep: z.number(),
});
export type DayChanges = z.infer<typeof DayChanges>;

export const DecisionRow = z.object({
  id: z.number(),
  accountId: z.string(),
  messageId: z.string(),
  decidedAt: z.number(),
  receivedAt: z.number(),
  stage,
  disposition: z.string(),
  /** What Mild said the mail is, or null if it could not place it. */
  labelId: z.string().nullable(),
  labelName: z.string().nullable(),
  gmailLabel: z.string().nullable(),
  /** The decision also says to unsubscribe. */
  unsubscribe: z.boolean(),
  reason: held,
  confidence: z.number().nullable(),
  model: z.string().nullable(),
  costUsd: z.number(),
  fromAddress: held,
  fromName: held.nullable(),
  subject: held,
  /** To be carried out in Gmail. Otherwise a suggestion, recorded only. */
  carryOut: z.boolean(),
  /** Null for a suggestion, and while a decision to carry out is waiting for a pass. */
  outcome: z.string().nullable(),
  /** Why Mild left it alone (`skipped`), in its own words. Never an error's. */
  outcomeDetail: z.string().nullable(),
  actionId: z.number().nullable(),
  actionStatus: z.string().nullable(),
  /** The user's own answer, not Mild's decision. */
  byUser: z.boolean(),
});
export type DecisionRow = z.infer<typeof DecisionRow>;

/** A decision in a list, with how its sender and the owner know each other. */
export const ListedDecision = DecisionRow.extend({ contact: Contact });
export type ListedDecision = z.infer<typeof ListedDecision>;

export const Summary = z.object({
  days: z.number(),
  accounts: z.array(z.object({ email: z.string(), lastSyncedAt: z.number().nullable() })),
  totals: z.object({
    /** Messages received in the window. */
    messages: z.number(),
    /** Messages Mild first decided in the window. */
    decided: z.number(),
    /** Of those, how many it decided without a model. */
    withoutInference: z.number(),
    /** Messages the model was asked about in the window, whatever came of it: what `costUsd` paid for. */
    judged: z.number(),
    costUsd: z.number(),
    /** Recorded messages with no decision yet (all time). */
    awaitingTriage: z.number(),
  }),
  /** Messages by the tier that first decided them, with what that cost. */
  byStage: z.array(z.object({ stage, decisions: z.number(), costUsd: z.number(), tokens: z.number() })),
  byDisposition: z.array(z.object({ disposition: z.string(), decisions: z.number() })),
  /** One entry per day in the window, oldest first, with a count for every stage. */
  daily: z.array(
    z.object({
      day: z.string(),
      counts: z.record(stage, z.number()),
      changes: DayChanges,
      costUsd: z.number(),
      /** Of the mail counted, how much was the label asked about. */
      labelled: z.number().optional(),
    }),
  ),
  topSenders: z.array(z.object({ address: held, messages: z.number(), lastDisposition: z.string().nullable() })),
  /**
   * What Mild took out of the inbox in the window, less the digests it put back, by the label it gave, most first;
   * and the senders it unsubscribed from, with what they sent in the month before.
   */
  saved: Saved.extend({
    byLabel: z.array(z.object({ labelId: z.string().nullable(), labelName: z.string().nullable(), messages: z.number() })),
    unsubscribed: z.object({ senders: z.number(), monthly: z.number() }),
  }),
  /** The ten latest decisions in the window. */
  recent: z.array(ListedDecision),
  /**
   * How often Mild's suggestion was what the user wanted, from the answers given in the window. Answers
   * to mail Mild could not place are not counted.
   */
  accuracy: z.object({
    reviewed: z.number(),
    right: z.number(),
    /** Every tier, in cascade order. */
    byStage: z.array(z.object({ stage, reviewed: z.number(), right: z.number() })),
    /** Per label Mild gave, most answers first. */
    byLabel: z.array(z.object({ labelId: z.string(), labelName: z.string(), reviewed: z.number(), right: z.number() })),
    /** What Mild called one label when the user said another, commonest first. */
    confusion: z.array(z.object({ suggested: z.string(), correct: z.string(), count: z.number() })),
  }),
});
export type Summary = z.infer<typeof Summary>;

/** GET /api/usage: what the model cost, in dollars, over the last day, week and 30 days; `daily` is those 30 days, oldest first. */
export const Usage = z.object({
  day: z.number(),
  week: z.number(),
  month: z.number(),
  daily: z.array(z.number()),
  /** What Mild took out of the inbox over the same windows; `daily` in seconds. `wouldHave`: 30 days of what it would have, had it been on. */
  saved: z.object({ day: Saved, week: Saved, month: Saved, daily: z.array(z.number()), wouldHave: Saved }),
});
export type Usage = z.infer<typeof Usage>;

/** GET /api/decisions: a page of decisions, and how many match in all. */
export const DecisionPage = z.object({ total: z.number(), rows: z.array(ListedDecision) });
export type DecisionPage = z.infer<typeof DecisionPage>;
