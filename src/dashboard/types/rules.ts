import { z } from 'zod';
import { FILTER_STATES } from '../../store/states.ts';
import { Saved, decided, held, heldMatch, ruleKind } from './parts.ts';

/** A rule's standing as a Gmail filter, which runs in Gmail itself and so applies when Mild is off. */
export const RuleFilter = z.object({
  /**
   * `none`: not in Gmail. `active`: Mild wrote it and it is still there. `changed`: it was edited in Gmail,
   * and Mild leaves it alone. `gone`: it was deleted in Gmail. `outdated`: the rule no longer says what the
   * filter does; Mild replaces or removes it once it is on. `RuleSummary.filterId` says whether Gmail still has one.
   */
  state: z.enum(['none', ...FILTER_STATES]),
  /** Whether the rule as it stands can be written as a filter. */
  possible: z.boolean(),
  /** Why not, in a sentence. */
  reason: z.string().nullable(),
  /** The filter Gmail would hold, when it can be one: to show before the user asks for it. */
  plan: z
    .object({
      criteria: z.object({ from: held.optional(), to: held.optional(), subject: held.optional() }),
      /** The Gmail label it applies, by name. */
      gmailLabel: z.string().optional(),
      archive: z.boolean(),
    })
    .nullable(),
  /** Where Gmail will not do exactly what the rule does. To show before the user asks for the filter. */
  differs: z.array(z.string()),
  /** When Mild last compared it with Gmail. */
  checkedAt: z.number().nullable(),
  /** Each time Mild wrote the filter to a mailbox's Gmail (`filter`) or took it out, and how that went, oldest first: one press is one per mailbox. */
  history: z.array(z.object({ type: z.enum(['filter', 'unfilter']), status: z.string(), error: z.string().nullable(), at: z.number(), mailbox: z.string() })),
});
export type RuleFilter = z.infer<typeof RuleFilter>;

export const RuleSummary = z.object({
  id: z.string(),
  match: heldMatch,
  except: z.array(heldMatch),
  /**
   * `label`: the mail is `labelId`, and that label's action applies unless the rule has its own.
   * `action`: only what happens, whatever the mail is. `when-label`: what happens once a tier has said
   * the mail is `whenLabel`.
   */
  kind: ruleKind,
  /** What the user calls it, said in place of its conditions. */
  name: held.nullable(),
  labelId: z.string().nullable(),
  whenLabel: z.string().nullable(),
  /** The name of the label the rule names or waits for. Null for an `action` rule. */
  labelName: z.string().nullable(),
  /** The rule's own action. For a `label` rule it is an exception to the label's. */
  override: z.string().nullable(),
  /** What happens to mail the rule decides: its own action, else its label's. */
  disposition: z.string().nullable(),
  /** Extras for mail the rule matches, from the rule or its label. */
  markRead: z.boolean(),
  unsubscribe: z.boolean(),
  /** A plain-language condition only the model can apply. */
  when: z.string().nullable(),
  /** `user`: written by the user. `correction`: made by correcting sift. `learned`: made by Mild when it blocked the sender. */
  source: z.string(),
  hits: z.number(),
  lastHitAt: z.number().nullable(),
  /** Model calls that checked the rule's condition over the last 30 days, met or not, and what they cost in dollars. */
  checks: z.number(),
  checkCost: z.number(),
  /** The rule's filter in Gmail, while there is one. */
  filterId: z.string().nullable(),
  filter: RuleFilter,
  createdAt: z.number(),
});
export type RuleSummary = z.infer<typeof RuleSummary>;

const InboxMessage = z.object({ accountId: z.string(), messageId: z.string(), subject: held, receivedAt: z.number() });

/**
 * What a rule decided and Mild has not moved: the newest of them, and how many in all. `applying`: how far
 * applying it to the inbox has got (`listed` false: still finding them, so `total` is how many so far).
 */
export const RuleWaiting = z.object({
  total: z.number(),
  messages: z.array(InboxMessage),
  applying: z.object({ listed: z.boolean(), done: z.number(), total: z.number() }).nullable(),
});
export type RuleWaiting = z.infer<typeof RuleWaiting>;

/**
 * What a rule decided each day, oldest first: `changed` was carried out in Gmail, `left` was not (Mild was
 * off, or it never landed). `costUsd` is the model calls that checked its condition that day, met or not.
 */
export const RuleUsage = z.object({
  daily: z.array(z.object({ day: z.string(), changed: z.number(), left: z.number(), costUsd: z.number() })),
  /** Of what it decided in those 30 days, what it took out of the inbox. */
  saved: Saved,
});
export type RuleUsage = z.infer<typeof RuleUsage>;

/**
 * What applying a rule to the inbox would do, from the newest mail Gmail finds for it: those examples, and how
 * many it would decide (`exact`, or scaled from them), of which `reading` a model must read first. `most`: how
 * many one press goes through, when more match than that. `costEach`: one model call with the person's model, in dollars, when known.
 */
export const RuleInbox = z.object({
  examples: z.array(InboxMessage),
  messages: z.number(),
  reading: z.number(),
  exact: z.boolean(),
  most: z.number().nullable(),
  costEach: z.number().nullable(),
});
export type RuleInbox = z.infer<typeof RuleInbox>;

/** A rule the model filled in from what the person wants, for the rule dialog to show. Nothing is made until they add it. */
export const RuleDraft = z.object({
  match: heldMatch,
  name: held.optional(),
  label: held.optional(),
  whenLabel: held.optional(),
  when: held.optional(),
  disposition: decided.optional(),
  markRead: z.literal(true).optional(),
  unsubscribe: z.literal(true).optional(),
  /** What else they need, or what a rule cannot do. */
  note: held.optional(),
});
export type RuleDraft = z.infer<typeof RuleDraft>;
