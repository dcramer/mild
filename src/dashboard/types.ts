/**
 * What the dashboard API sends, and the bodies the page sends it, as schemas the server parses them
 * with. The web app imports only their types, so zod stays out of the page; keep this file's imports to
 * zod and the pure triage types.
 */
import { z } from 'zod';
import { RULE_FACTS, type RuleFacts as Conditions, factCondition } from '../triage/facts.ts';
import { DECIDED } from '../triage/types.ts';

export const STAGES = ['rules', 'classifier', 'model', 'fallback'] as const;
export type StageKey = (typeof STAGES)[number];
const stage = z.enum(STAGES);

const LABEL_ID = /^[a-z0-9_-]{1,40}$/;
/** Text a person typed or the page sent, not empty and not long. */
export const text = (max = 200) => z.string().min(1).max(max);
export const labelId = z.string().regex(LABEL_ID);
export const decided = z.enum(DECIDED);
const ruleKind = z.enum(['label', 'action', 'when-label']);
/** A rule's conditions on facts: each fact named once, with one of the answers `RULE_FACTS` gives it. */
export const RuleFacts = z.strictObject(
  Object.fromEntries(
    Object.keys(RULE_FACTS).map((key) => [
      key,
      z
        .unknown()
        .refine((want) => factCondition(key, want) !== null, { error: `is not an answer sift has for ${key}` })
        .optional(),
    ]),
  ),
) as unknown as z.ZodType<Conditions>;
export type RuleFacts = Conditions;
const match = z.object({
  from: z.string().optional(),
  fromDomain: z.string().optional(),
  to: z.string().optional(),
  listId: z.string().optional(),
  subjectContains: z.string().optional(),
  facts: RuleFacts.optional(),
});
export type RuleMatch = z.infer<typeof match>;

/** The facts Suggestions and Activity can be narrowed by (`?fact=`), each a condition on what sift recorded about the message. */
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
const answered = z.object({ reviewed: z.number(), right: z.number() });

/** What was done in Gmail on a day: changes that stand, by what they did, and changes that failed. */
export const DayChanges = z.object({
  archive: z.number(),
  spam: z.number(),
  keep: z.number(),
  failed: z.number(),
});
export type DayChanges = z.infer<typeof DayChanges>;

export const DecisionRow = z.object({
  id: z.number(),
  accountId: z.string(),
  messageId: z.string(),
  decidedAt: z.number(),
  stage,
  disposition: z.string(),
  /** What sift said the mail is, or null if it could not place it. */
  labelId: z.string().nullable(),
  labelName: z.string().nullable(),
  gmailLabel: z.string().nullable(),
  /** The decision also says to unsubscribe. */
  unsubscribe: z.boolean(),
  reason: z.string(),
  confidence: z.number().nullable(),
  model: z.string().nullable(),
  costUsd: z.number(),
  fromAddress: z.string(),
  fromName: z.string().nullable(),
  subject: z.string(),
  /** To be carried out in Gmail. Otherwise a suggestion, recorded only. */
  carryOut: z.boolean(),
  /** Null for a suggestion, and while a decision to carry out is waiting for a pass. */
  outcome: z.string().nullable(),
  outcomeDetail: z.string().nullable(),
  actionId: z.number().nullable(),
  actionType: z.string().nullable(),
  actionStatus: z.string().nullable(),
  /** The user's own answer, not sift's decision. */
  byUser: z.boolean(),
});
export type DecisionRow = z.infer<typeof DecisionRow>;

export const Summary = z.object({
  days: z.number(),
  accounts: z.array(z.object({ email: z.string(), lastSyncedAt: z.number().nullable() })),
  totals: z.object({
    /** Messages received in the window. */
    messages: z.number(),
    /** Messages sift first decided in the window. */
    decided: z.number(),
    /** Of those, how many it decided without a model. */
    withoutInference: z.number(),
    /** Messages the model was asked about in the window, whatever came of it: what `costUsd` paid for. */
    judged: z.number(),
    costUsd: z.number(),
    /** Recorded messages with no decision yet (all time). */
    awaitingTriage: z.number(),
    /** Actions in the window that failed or whose outcome is unconfirmed. */
    troubledActions: z.number(),
  }),
  /** Messages by the tier that first decided them, with what that cost. */
  byStage: z.array(z.object({ stage, decisions: z.number(), costUsd: z.number(), tokens: z.number() })),
  byDisposition: z.array(z.object({ disposition: z.string(), decisions: z.number() })),
  /** One entry per day in the window, oldest first, with a count for every stage. */
  daily: z.array(z.object({ day: z.string(), counts: z.record(stage, z.number()), changes: DayChanges, costUsd: z.number() })),
  topSenders: z.array(z.object({ address: z.string(), messages: z.number(), lastDisposition: z.string().nullable() })),
  /** The ten latest decisions in the window. */
  recent: z.array(DecisionRow),
  /**
   * How often sift's suggestion was what the user wanted, from the answers given in the window. Answers
   * to mail sift could not place are not counted.
   */
  accuracy: z.object({
    reviewed: z.number(),
    right: z.number(),
    /** Every tier, in cascade order. */
    byStage: z.array(z.object({ stage, reviewed: z.number(), right: z.number() })),
    /** Per label sift gave, most answers first. */
    byLabel: z.array(z.object({ labelId: z.string(), labelName: z.string(), reviewed: z.number(), right: z.number() })),
    /** What sift called one label when the user said another, commonest first. */
    confusion: z.array(z.object({ suggested: z.string(), correct: z.string(), count: z.number() })),
  }),
});
export type Summary = z.infer<typeof Summary>;

/** GET /api/decisions: a page of decisions, and how many match in all. */
export const DecisionPage = z.object({ total: z.number(), rows: z.array(DecisionRow) });
export type DecisionPage = z.infer<typeof DecisionPage>;

export const Standing = z.enum(['trusted', 'known', 'new', 'unwanted', 'blocked']);
export type Standing = z.infer<typeof Standing>;

const authentication = z.enum(['pass', 'fail', 'none']);

/** What sift checked about one message. Mirrors `Facts` in src/triage/facts.ts, which says what each means. */
const MessageFactSet = z.object({
  unsubscribe: z.enum(['none', 'header', 'one-click']),
  listId: z.string().nullable(),
  markedBulk: z.boolean(),
  autoGenerated: z.boolean(),
  dmarc: authentication,
  spf: authentication,
  dkim: authentication,
  bulkService: z.string().nullable(),
  replyToDiffers: z.boolean(),
  addressed: z.enum(['to', 'cc', 'neither']),
  isReply: z.boolean(),
  category: z.enum(['personal', 'social', 'promotions', 'updates', 'forums']).nullable(),
  /** These five are known only once a model has been asked about the message; the last four only for mail with HTML. */
  hasAttachments: z.boolean().optional(),
  trackingPixel: z.boolean().optional(),
  linkHosts: z.number().optional(),
  trackedLinks: z.boolean().optional(),
  linksOffDomain: z.boolean().optional(),
  /** Known only for a reply a model has been asked about. */
  earlierInThread: z.number().optional(),
  ownerInThread: z.boolean().optional(),
});
type MessageFactSet = z.infer<typeof MessageFactSet>;

/** What sift knows about one sender, or about everyone at one domain, to judge their mail by. */
export const SenderProfile = z.object({
  /** An address, or for a domain's profile the domain. */
  address: z.string(),
  /** How the owner regards them, and the reason in a few words. */
  standing: Standing,
  why: z.string(),
  lastSeenAt: z.number().nullable(),
  /** Messages in the last 30 days. */
  recent: z.number(),
  /** For a domain: how many addresses have written from it. */
  senders: z.number(),
  /** Share of their labelled mail that got the commonest label, 0 to 1. Null with too little to say. */
  consistency: z.number().nullable(),
  /** The owner's answers about their mail. */
  answers: z.object({ right: z.number(), wrong: z.number() }),
  /** The sender's domain, with its own standing. Null for a domain's own profile and for a domain anyone can get an address at. */
  domain: z.object({ name: z.string(), standing: Standing, why: z.string(), messages: z.number(), senders: z.number() }).nullable(),
  /** Messages recorded from this address. */
  messages: z.number(),
  firstSeenAt: z.number().nullable(),
  /** Whether the account owner has ever written to this address. Null if that has not been checked. */
  userHasWritten: z.boolean().nullable(),
  /** What this sender's mail currently is, by label, most first. */
  labels: z.array(z.object({ id: z.string(), name: z.string(), messages: z.number() })),
  /** Rules that name this sender or their domain. */
  rules: z.array(
    z.object({
      id: z.string(),
      match,
      labelName: z.string().nullable(),
      disposition: z.string().nullable(),
      source: z.string(),
      kind: ruleKind,
      when: z.string().nullable(),
    }),
  ),
});
export type SenderProfile = z.infer<typeof SenderProfile>;

const address = z.object({ address: z.string(), name: z.string().optional() });

export const MessageDetail = z.object({
  accountId: z.string(),
  messageId: z.string(),
  threadId: z.string(),
  fromAddress: z.string(),
  fromName: z.string().nullable(),
  to: z.array(address),
  cc: z.array(address),
  subject: z.string(),
  listId: z.string().nullable(),
  receivedAt: z.number(),
  /** Triage headers as synced. */
  headers: z.record(z.string(), z.string()),
  /**
   * The readable text, where sift holds it: while the message is waiting on the user (and sift would move it or
   * could not place it), or for good once the user has answered for it. Null otherwise.
   */
  body: z.string().nullable(),
  /** Whether it has an HTML part to show. Null until sift has read the whole message, as for mail a rule placed. */
  hasHtml: z.boolean().nullable(),
  facts: MessageFactSet,
  sender: SenderProfile,
  /**
   * Whether sift could leave the list this message came from. `available`: yes, with one request to the sender.
   * `done`: it already has. `manual`: the message has an unsubscribe link sift will not use (it needs an
   * email sent or a page opened, or the message did not prove who sent it). `none`: it offers no way.
   */
  unsubscribe: z.enum(['available', 'done', 'manual', 'none']),
  /** Every decision made about this message, oldest first. */
  decisions: z.array(
    DecisionRow.extend({ ruleId: z.string().nullable(), inputTokens: z.number(), outputTokens: z.number(), durationMs: z.number().nullable() }),
  ),
  /** Every mailbox change made to this message, oldest first. */
  actions: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      status: z.string(),
      decisionId: z.number().nullable(),
      added: z.array(z.string()),
      removed: z.array(z.string()),
      originalLabels: z.array(z.string()),
      finalLabels: z.array(z.string()).nullable(),
      error: z.string().nullable(),
      createdAt: z.number(),
    }),
  ),
});
export type MessageDetail = z.infer<typeof MessageDetail>;

/** GET /api/sender and /api/domain. */
export const SenderPage = z.object({
  accountId: z.string(),
  kind: z.enum(['sender', 'domain']),
  /** The name the sender last used. */
  name: z.string().nullable(),
  profile: SenderProfile,
  /** For a domain: who writes from it, most mail first. */
  senders: z.array(z.object({ address: z.string(), name: z.string().nullable(), messages: z.number(), lastSeenAt: z.number(), standing: Standing })),
  /** Their mail, newest first. */
  decisions: z.array(DecisionRow),
  /** How much of it is waiting on the owner. */
  waiting: z.number(),
});
export type SenderPage = z.infer<typeof SenderPage>;

/** One sender's mail that is waiting on the user. GET /api/suggestion. */
export const SuggestionDetail = z.object({
  sender: SenderProfile,
  messages: z.array(
    z.object({
      decisionId: z.number(),
      messageId: z.string(),
      subject: z.string(),
      receivedAt: z.number(),
      disposition: z.string(),
      labelId: z.string().nullable(),
      labelName: z.string().nullable(),
      stage,
      reason: z.string(),
    }),
  ),
});
export type SuggestionDetail = z.infer<typeof SuggestionDetail>;

/** A rule's standing as a Gmail filter, which runs in Gmail itself and so applies when sift is off. */
export const RuleFilter = z.object({
  /**
   * `none`: not in Gmail. `active`: sift wrote it and it is still there. `changed`: it was edited in Gmail,
   * and sift leaves it alone. `gone`: it was deleted in Gmail. `outdated`: the rule no longer says what the
   * filter does; sift replaces or removes it once it is on. `RuleSummary.filterId` says whether Gmail still has one.
   */
  state: z.enum(['none', 'active', 'changed', 'gone', 'outdated']),
  /** Whether the rule as it stands can be written as a filter. */
  possible: z.boolean(),
  /** Why not, in a sentence. */
  reason: z.string().nullable(),
  /** Where Gmail will not do exactly what the rule does. To show before the user asks for the filter. */
  differs: z.array(z.string()),
  /** When sift last compared it with Gmail. */
  checkedAt: z.number().nullable(),
});
export type RuleFilter = z.infer<typeof RuleFilter>;

export const RuleSummary = z.object({
  id: z.string(),
  accountId: z.string(),
  match,
  except: z.array(match),
  /**
   * `label`: the mail is `labelId`, and that label's action applies unless the rule has its own.
   * `action`: only what happens, whatever the mail is. `when-label`: what happens once a tier has said
   * the mail is `whenLabel`.
   */
  kind: ruleKind,
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
  /** `user`: written by the user. `correction`: made by correcting sift. `learned`: made by sift when it blocked the sender. */
  source: z.string(),
  hits: z.number(),
  lastHitAt: z.number().nullable(),
  /** The rule's filter in Gmail, while there is one. */
  filterId: z.string().nullable(),
  filter: RuleFilter,
  createdAt: z.number(),
});
export type RuleSummary = z.infer<typeof RuleSummary>;

/** One waiting suggestion: what sift proposes for one message, which the user has not answered. */
export const SuggestionItem = z.object({
  accountId: z.string(),
  messageId: z.string(),
  decisionId: z.number(),
  sender: z.string(),
  senderName: z.string().nullable(),
  subject: z.string(),
  receivedAt: z.number(),
  /** What sift would do. `review` without a label means it could not place the mail. */
  disposition: z.string(),
  /** What sift says the mail is, or null if it could not place it. */
  labelId: z.string().nullable(),
  labelName: z.string().nullable(),
  /** sift would also unsubscribe. */
  unsubscribe: z.boolean(),
  /** Which tier decided, and how sure a model was (0 to 1); null when no model was asked. */
  stage,
  confidence: z.number().nullable(),
  /**
   * What else it might be, most likely first: the labels the sender's other mail has had, with the share
   * of it each had. Until the model ranks its own guesses, this is the best second opinion sift holds.
   */
  alternatives: z.array(z.object({ id: z.string(), name: z.string(), share: z.number() })),
  /** The start of the message's text, on one line, where sift holds it: enough to tell what it is without opening it. */
  preview: z.string().nullable(),
});
export type SuggestionItem = z.infer<typeof SuggestionItem>;

/** A rule sift thinks is worth having, for the user to accept or dismiss. */
const ProposalSummary = z.object({
  id: z.number(),
  accountId: z.string(),
  /** `rule`: make this rule. `always`: stop having the model check a rule it has always agreed with. */
  kind: z.enum(['rule', 'always']),
  match,
  labelId: z.string(),
  labelName: z.string(),
  /** What the label does to mail. */
  disposition: z.string(),
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
  /** The labels the user can say something is, per account, with what sift does for each. */
  labels: z.record(z.string(), z.array(z.object({ id: z.string(), name: z.string(), disposition: z.string() }))),
  /** Marked messages kept whole as examples, and how many are still to be fetched. */
  examples: z.object({ captured: z.number(), pending: z.number() }),
});
export type Suggestions = z.infer<typeof Suggestions>;

/** The body of POST /api/feedback. */
export const FeedbackRequest = z
  .strictObject({
    accountId: z.string(),
    sender: z.string(),
    /** What the mail is: a label's id. Left out when the answer says only what should happen. */
    label: labelId.optional(),
    /** What should happen to it. Left out: what the label does. */
    disposition: decided.optional(),
    /** Also unsubscribe, whether or not the label does. */
    unsubscribe: z.boolean().optional(),
    /** A plain-language condition that narrows a rule for the sender. Needs `label`. */
    when: z.string().max(200).optional(),
    /**
     * How far the answer reaches, and so what rule it makes. `label`: the sender's mail of this kind (what
     * agreeing means). `sender`, `domain`, `subject`: that mail whatever it is. `once`: no rule.
     */
    scope: z.enum(['label', 'sender', 'domain', 'subject', 'once']),
    /** For `subject`: the words the subject must contain. */
    contains: z.string().max(200).optional(),
    decisionId: z.int().optional(),
    /** The message the answer was given on, which need not be waiting: this is how a decision already made is corrected. */
    messageId: text().optional(),
  })
  .refine((a) => a.label !== undefined || a.disposition !== undefined, { message: 'An answer says what the mail is, what should happen to it, or both.' })
  .refine((a) => a.label !== undefined || (a.scope !== 'label' && a.when === undefined), { path: ['label'], message: 'This answer needs a label.' })
  .refine((a) => a.scope !== 'subject' || (a.contains ?? '').trim() !== '', { path: ['contains'], message: 'An answer about a subject needs its words.' });
export type FeedbackRequest = z.infer<typeof FeedbackRequest>;

/** What POST /api/feedback answers. */
export const FeedbackReply = z.object({
  /** Suggestions this answer settled. */
  reviewed: z.number(),
  /** What sift will do differently from now on, in a sentence. Null if nothing lasting was learned. */
  taught: z.string().nullable(),
  /** The message whose earlier decision was replaced. */
  corrected: z.string().nullable(),
  /** How many messages now have the answer waiting to be carried out in Gmail. */
  carrying: z.number(),
  /** sift proposed a rule because the sender's mail has been answered the same way enough times. */
  proposed: z.boolean(),
  /** What was done in Gmail about the corrected message, in a sentence. Null if nothing needed doing. */
  fixed: z.string().nullable(),
});
export type FeedbackReply = z.infer<typeof FeedbackReply>;

/** A label: what mail is, and what sift does with it. */
export const LabelSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** What sift does with it: `keep`, `archive`, `spam`, or `block` (spam, and the sender's later mail too). */
  disposition: z.string(),
  /** Also mark the mail read. Only with `keep` and `archive`. */
  markRead: z.boolean(),
  /** Also leave the sender's mailing list, where that can be done safely. */
  unsubscribe: z.boolean(),
  gmailLabel: z.string(),
  /** Rules that say mail is this label. */
  rules: z.number(),
  /** Messages whose current decision carries this label. */
  messages: z.number(),
  /** Of the suggestions for this label the user has answered, how many sift had right. */
  record: answered,
});
export type LabelSummary = z.infer<typeof LabelSummary>;

/**
 * A ChatGPT sign-in waiting on the person: where to go, and by device code the code to enter there.
 * Without a code, it is a Sign in with ChatGPT, finished by pasting back the address it ends on.
 */
export const SignInCode = z.object({ code: z.string().optional(), url: z.string(), expiresAt: z.number() });
export type SignInCode = z.infer<typeof SignInCode>;

/** GET /api/manage: everything the Settings view shows. */
export const ManageState = z.object({
  /** Whether the viewer owns the install, and so may change what applies to all of it. */
  owner: z.boolean(),
  /** Whether sift is on for the viewer. Off, it only suggests for their mail; on, it carries its decisions out in Gmail. */
  active: z.boolean(),
  /** The viewer's own model: which one they chose, how they can reach one, and a ChatGPT sign-in under way. */
  model: z.object({
    chosen: z.string().nullable(),
    choices: z.array(z.object({ provider: z.string(), label: z.string(), how: z.enum(['device-code', 'redirect', 'key']) })),
    signedIn: z.array(z.string()),
    pending: z.union([SignInCode, z.object({ error: z.string() })]).nullable(),
  }),
  activity: z.object({ running: z.boolean(), lastPassAt: z.number().nullable(), problems: z.array(z.string()), expired: z.array(z.string()) }),
  accounts: z.array(z.object({ id: z.string(), email: z.string(), lastSyncedAt: z.number().nullable() })),
  /** Per account, in order. */
  labels: z.record(z.string(), z.array(LabelSummary)),
  /** How many labels an account may have. */
  labelLimit: z.number(),
});
export type ManageState = z.infer<typeof ManageState>;

/** GET /api/models: the models the viewer's sign-ins offer, and per provider the one to suggest first. */
export const Models = z.object({
  models: z.array(z.string()),
  recommended: z.record(z.string(), z.string()),
  /** A provider could not be reached. */
  error: z.string().optional(),
});
export type Models = z.infer<typeof Models>;

/** A change sift made to the mailbox. */
export const ChangeRow = z.object({
  id: z.number(),
  accountId: z.string(),
  messageId: z.string(),
  type: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  createdAt: z.number(),
  subject: z.string().nullable(),
  fromAddress: z.string().nullable(),
  /** For an undo, the change it reversed. */
  undoOf: z.number().nullable(),
});
export type ChangeRow = z.infer<typeof ChangeRow>;

/** Mail the model failed on every time it was tried. `error` is what went wrong the last time. */
export const UnjudgedRow = z.object({
  accountId: z.string(),
  messageId: z.string(),
  fromAddress: z.string(),
  fromName: z.string().nullable(),
  subject: z.string(),
  error: z.string().nullable(),
  triedAt: z.number(),
});
export type UnjudgedRow = z.infer<typeof UnjudgedRow>;

/** GET /api/session. */
export const Session = z.object({
  /** False when this dashboard does not ask for sign-in. */
  required: z.boolean(),
  /** The signed-in account, or null. */
  email: z.string().nullable(),
  canSignIn: z.boolean(),
  /** Why not: no Google client is set up, or Google cannot return to this address. */
  reason: z.enum(['no-client', 'address']).nullable(),
  /** Addresses sign-in works at. */
  addresses: z.array(z.string()),
});
export type Session = z.infer<typeof Session>;

/** Right, wrong, "unsure" and failed calls among some judged examples. Accuracy is `right / (total - failed)`. */
const EvalTally = z.object({
  total: z.number(),
  right: z.number(),
  wrong: z.number(),
  unsure: z.number(),
  /** Calls that returned nothing usable. Not counted for or against. */
  failed: z.number(),
});
type EvalTally = z.infer<typeof EvalTally>;

const EvalScore = EvalTally.extend({
  /** By the label the user gave, most examples first. */
  byLabel: z.array(EvalTally.extend({ labelId: z.string() })),
  /** Which label was taken for which, commonest first. */
  confusion: z.array(z.object({ expected: z.string(), got: z.string(), count: z.number() })),
  costUsd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  /** Averages over the calls that answered. */
  perMessage: z.object({ costUsd: z.number(), inputTokens: z.number(), outputTokens: z.number() }),
});
type EvalScore = z.infer<typeof EvalScore>;

/** One replay of the model over stored examples. */
export const EvalRun = z.object({
  id: z.number(),
  accountId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  /** `interrupted`: sift stopped while it was going. */
  status: z.enum(['running', 'done', 'failed', 'interrupted']),
  error: z.string().nullable(),
  /** What it ran with. Runs that agree on all of these were asked the same question the same way. */
  model: z.string(),
  promptHash: z.string(),
  labelsHash: z.string(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
  fewShot: z.boolean(),
  /** Examples in the run. `score.total` is how many have been judged so far. */
  total: z.number(),
  score: EvalScore,
  /** Of the answers, those given with an example from the same sender in the prompt, which makes them easy. */
  withSenderExample: z.object({ answered: z.number(), right: z.number() }),
});
export type EvalRun = z.infer<typeof EvalRun>;

/** GET /api/evals. */
export const Evals = z.object({
  /** Newest first. */
  runs: z.array(EvalRun),
  /** Stored examples a run could use, per account. */
  examples: z.record(z.string(), z.number()),
  defaultLimit: z.number(),
  maxLimit: z.number(),
});
export type Evals = z.infer<typeof Evals>;

/** GET /api/eval?id=. */
export const EvalDetail = z.object({
  run: EvalRun,
  results: z.array(
    z.object({
      messageId: z.string(),
      fromAddress: z.string(),
      subject: z.string(),
      /** The user's label. */
      expected: z.string(),
      /** A label id, `unsure`, or null when the call failed. */
      got: z.string().nullable(),
      /** Why the call failed: its status and kind. */
      error: z.string().nullable(),
      confidence: z.number().nullable(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      costUsd: z.number(),
      durationMs: z.number(),
      /** Examples shown beside it, and how many of those were from the same sender. */
      shots: z.number(),
      senderShots: z.number(),
    }),
  ),
});
export type EvalDetail = z.infer<typeof EvalDetail>;

/** The body of POST /api/evals/run. Answers `{ id }`; the run goes on in the background. */
export const EvalRequest = z.strictObject({
  accountId: text(),
  /** Show the model the other stored examples, as sorting always does. Default: true. */
  fewShot: z.boolean().optional(),
  /** How many examples, newest answers first. At most `Evals.maxLimit`. */
  limit: z.int().min(1).optional(),
});
export type EvalRequest = z.infer<typeof EvalRequest>;

/** GET /api/examples: the messages held whole because the user answered for them. No content. */
export const Examples = z.object({
  /** Newest answers first, at most 500. */
  examples: z.array(
    z.object({
      accountId: z.string(),
      messageId: z.string(),
      fromAddress: z.string(),
      fromName: z.string().nullable(),
      subject: z.string(),
      /** The user's answer. */
      labelId: z.string().nullable(),
      markedAt: z.number(),
      /** `pending`: not fetched yet. `gone`: the message no longer existed, so only the answer is held. */
      status: z.enum(['pending', 'captured', 'gone']),
    }),
  ),
  /** How many are held per account, including any beyond the list. */
  held: z.record(z.string(), z.number()),
});
export type Examples = z.infer<typeof Examples>;

/** What POST /api/mailbox/remove and /api/account/delete answer. */
export const Removed = z.object({
  /** Mailboxes whose access Google could not be reached to revoke. Removed all the same. */
  notRevoked: z.array(z.string()),
  /** Their session has ended. */
  signedOut: z.boolean(),
});
export type Removed = z.infer<typeof Removed>;
