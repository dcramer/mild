/**
 * The database, as Drizzle describes it. Change it here, then `pnpm db:generate` writes the migration
 * (into `src/store/migrations/`); never edit one that has been applied, and never write schema SQL by
 * hand anywhere else.
 *
 * Two kinds of table. `users` and `accounts` say who the people are and which mailboxes are whose, and
 * are read before anyone is known. Every other table holds one person's data: it carries their
 * `user_id`, which the handle sets (src/store/own.ts), and row-level security lets a transaction see and
 * write only that person's rows (src/store/sql.ts). Every key and foreign key between them includes
 * `user_id`, so no row can point at another person's.
 *
 * Deleting is one statement. Deleting a `users` row deletes everything of theirs; deleting an `accounts`
 * row deletes its mailbox and, through it, every row with that `account_id`. Keys into `messages`,
 * `decisions` and `model_runs` do not cascade, so retention has to delete those rows on purpose.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Facts } from '../triage/facts.ts';
import type { RuleMatch } from '../triage/stages/rules.ts';
import { DECIDED, DISPOSITIONS, STAGE_NAMES, SUBSCRIPTION_ACTIONS } from '../triage/types.ts';
import type { ActionPayload } from './actions.ts';

export const CREDENTIAL_KINDS = ['gmail', 'model'] as const;
export const DECISION_OUTCOMES = ['none', 'done', 'skipped', 'failed', 'unknown'] as const;
export const ACTION_TYPES = ['archive', 'spam', 'label', 'undo', 'unsubscribe', 'filter', 'unfilter'] as const;
export const ACTION_STATUSES = ['pending', 'done', 'failed', 'unknown', 'undone'] as const;
/** `learned`: sift made it (blocking a sender). */
export const RULE_SOURCES = ['user', 'learned', 'correction'] as const;
/** `changed`: edited in Gmail. `gone`: deleted there. `outdated`: the rule no longer says what the filter does. */
export const FILTER_STATES = ['active', 'changed', 'gone', 'outdated'] as const;
/** `rule`: make one for its match. `always`: stop checking a judged rule the model has agreed with every time. */
export const PROPOSAL_KINDS = ['rule', 'always'] as const;
const PROPOSAL_STATUSES = ['open', 'accepted', 'dismissed'] as const;
/** right: sift's suggestion was what they wanted. wrong: it was not. answered: sift had no suggestion. */
export const VERDICTS = ['right', 'wrong', 'answered'] as const;
const FEEDBACK_VIA = ['dashboard', 'gmail'] as const;
export const EXAMPLE_STATUSES = ['pending', 'captured', 'gone'] as const;
/** interrupted: sift stopped while it ran. */
export const EVAL_STATUSES = ['running', 'done', 'failed', 'interrupted'] as const;
export const RUN_OUTCOMES = ['judged', 'failed'] as const;

/** What sift's own queries run as: it owns nothing and cannot bypass row-level security. */
export const siftApp = pgRole('sift_app', { createRole: false });

// After a transaction that set it, the setting reads as '' for the rest of the session: that is nobody too.
const OWN = sql`user_id = nullif(current_setting('sift.user', true), '')::integer`;
/** Each person's table: only their rows, read or written. */
const own = () => pgPolicy('own', { for: 'all', to: siftApp, using: OWN, withCheck: OWN });

/** Holds the column to `values`, the same list its TypeScript type comes from. */
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]): ReturnType<typeof check> =>
  check(name, sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`);

/** Milliseconds since the epoch. */
const time = (name: string) => bigint(name, { mode: 'number' });
const id = () => integer('id').primaryKey().generatedByDefaultAsIdentity();
const userId = () =>
  integer('user_id')
    .notNull()
    .default(sql`current_setting('sift.user')::integer`)
    .references((): AnyPgColumn => users.id, { onDelete: 'cascade' });

// Who the people are and which mailboxes are whose.

/** A person. The first owns the install: only they may change what applies to all of it. */
export const users = pgTable(
  'users',
  {
    id: id(),
    owner: boolean('owner').notNull().default(false),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('users_one_owner')
      .on(t.owner)
      .where(sql`${t.owner}`),
  ],
);

/** A mailbox, an identity someone signed in with. Its id is its address. It never changes hands. */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: time('created_at').notNull(),
  },
  (t) => [unique('accounts_own').on(t.userId, t.id)],
);

// One person's data.

/** Their mailboxes, with each one's sync state. */
export const mailboxes = pgTable(
  'mailboxes',
  {
    userId: userId(),
    id: text('id').notNull(),
    historyId: text('history_id'), // Gmail history cursor; null forces a full sync
    lastSyncedAt: time('last_synced_at'),
    filtersCheckedAt: time('filters_checked_at'),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]), // Gmail send-as addresses besides the id, as of the last sync that could read them
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.id], foreignColumns: [accounts.userId, accounts.id] }).onDelete('cascade'),
    own(),
  ],
).enableRLS();

/** Every table with an `account_id` has this key, so removing a mailbox removes its rows. */
const mailbox = (t: { userId: AnyPgColumn; accountId: AnyPgColumn }) =>
  foreignKey({ columns: [t.userId, t.accountId], foreignColumns: [mailboxes.userId, mailboxes.id] }).onDelete('cascade');

/** Their own choices: the model their mail is judged with (`provider/model-id`). */
export const preferences = pgTable(
  'preferences',
  {
    userId: userId().primaryKey(),
    // false (off): their decisions are only suggestions. true (on): sift carries them out in their mailboxes.
    active: boolean('active').notNull().default(false),
    model: text('model'),
  },
  () => [own()],
).enableRLS();

/**
 * Their sign-ins, each encrypted for its row (src/secrets.ts). `gmail`: a mailbox's refresh token, by
 * address. `model`: a model provider's credential, by provider id.
 */
export const credentials = pgTable(
  'credentials',
  {
    userId: userId(),
    kind: text('kind', { enum: CREDENTIAL_KINDS }).notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.key] }), oneOf('credentials_kind', t.kind, CREDENTIAL_KINDS), own()],
).enableRLS();

/** Every message sift has seen, without the body: enough to triage it again and show what sift did. */
export const messages = pgTable(
  'messages',
  {
    userId: userId(),
    accountId: text('account_id').notNull(),
    id: text('id').notNull(), // provider message id
    threadId: text('thread_id').notNull(),
    fromAddress: text('from_address').notNull(),
    fromDomain: text('from_domain').notNull(),
    // These five are encrypted, each on its own (src/store/content.ts); to, cc and headers as JSON.
    fromName: text('from_name'),
    listId: text('list_id'),
    receivedAt: time('received_at').notNull(),
    subject: text('subject').notNull(),
    to: text('to_addresses').notNull(),
    cc: text('cc_addresses').notNull(),
    headers: text('headers').notNull(), // the triage headers only (see METADATA_HEADERS)
    labelIds: jsonb('label_ids').$type<string[]>().notNull().default([]), // when synced; a snapshot, not current state
    syncedAt: time('synced_at').notNull(),
    suggestOnly: boolean('suggest_only').notNull().default(false), // pulled in from before sift was connected: suggest, never carry out
    facts: jsonb('facts').$type<Facts>().notNull(),
    readAt: time('read_at'), // when a sync saw the user had opened it
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.accountId, t.id] }),
    mailbox(t),
    index('messages_sender').on(t.accountId, t.fromAddress),
    index('messages_domain').on(t.accountId, t.fromDomain),
    index('messages_received').on(t.accountId, t.receivedAt),
    // Lists narrowed by a fact ask `facts @> {…}`.
    index('messages_facts').using('gin', t.facts),
    own(),
  ],
).enableRLS();

const message = (t: { userId: AnyPgColumn; accountId: AnyPgColumn; messageId: AnyPgColumn }) =>
  foreignKey({ columns: [t.userId, t.accountId, t.messageId], foreignColumns: [messages.userId, messages.accountId, messages.id] });

/** What mail can be, and what sift does with each. */
export const labels = pgTable(
  'labels',
  {
    userId: userId(),
    accountId: text('account_id').notNull(),
    id: text('id').notNull(), // stable; the name can change without orphaning history
    name: text('name').notNull(),
    description: text('description').notNull(), // how to recognise it; shown to the model
    disposition: text('disposition', { enum: DISPOSITIONS }).notNull(),
    block: boolean('block').notNull().default(false),
    markRead: boolean('mark_read').notNull().default(false),
    unsubscribe: boolean('unsubscribe').notNull().default(false),
    gmailLabel: text('gmail_label').notNull(),
    position: integer('position').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.accountId, t.id] }), mailbox(t), oneOf('labels_disposition', t.disposition, DISPOSITIONS), own()],
).enableRLS();

/** What a row says mail is: one of its mailbox's labels. Labels are never deleted. */
const label = (name: string, t: { userId: AnyPgColumn; accountId: AnyPgColumn }, column: AnyPgColumn) =>
  foreignKey({ name, columns: [t.userId, t.accountId, column], foreignColumns: [labels.userId, labels.accountId, labels.id] });

/** Every call to the model about a message, with what it cost. One that failed reached no decision, so the message is asked about again on a later pass. */
export const modelRuns = pgTable(
  'model_runs',
  {
    id: id(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    messageId: text('message_id').notNull(),
    model: text('model').notNull(),
    startedAt: time('started_at').notNull(),
    finishedAt: time('finished_at'),
    outcome: text('outcome', { enum: RUN_OUTCOMES }), // null: the pass stopped part-way, which counts as failed
    error: text('error'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    retriedAt: time('retried_at'), // the user put the message back in the queue: this failure no longer counts
  },
  (t) => [
    unique('model_runs_own').on(t.userId, t.id),
    mailbox(t),
    message(t),
    oneOf('model_runs_outcome', t.outcome, RUN_OUTCOMES),
    index('model_runs_message').on(t.accountId, t.messageId),
    index('model_runs_time').on(t.accountId, t.startedAt),
    own(),
  ],
).enableRLS();

/** An append-only log: a message can be decided more than once, and the highest id is current. */
export const decisions = pgTable(
  'decisions',
  {
    id: id(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    messageId: text('message_id').notNull(),
    stage: text('stage', { enum: STAGE_NAMES }).notNull(),
    disposition: text('disposition', { enum: DISPOSITIONS }).notNull(),
    subscription: text('subscription', { enum: SUBSCRIPTION_ACTIONS }).notNull(),
    labelId: text('label_id'),
    gmailLabel: text('gmail_label'),
    block: boolean('block').notNull().default(false),
    markRead: boolean('mark_read').notNull().default(false),
    ruleId: text('rule_id'),
    priorRuleId: text('prior_rule_id'), // the judged rule the model was shown, whether or not it agreed
    confidence: doublePrecision('confidence'),
    reason: text('reason').notNull(),
    runId: integer('run_id'), // the model call that reached it; null when no model was asked
    durationMs: integer('duration_ms'),
    decidedAt: time('decided_at').notNull(),
    // false: a suggestion, recorded only. true: to be carried out in Gmail; outcome is null until it has been.
    carryOut: boolean('carry_out').notNull().default(false),
    outcome: text('outcome', { enum: DECISION_OUTCOMES }),
    outcomeDetail: text('outcome_detail'),
    // The user's own answer, from the dashboard or from what they did in Gmail. Carried out even while sift is off.
    byUser: boolean('by_user').notNull().default(false),
  },
  (t) => [
    unique('decisions_own').on(t.userId, t.id),
    mailbox(t),
    message(t),
    label('decisions_label', t, t.labelId),
    foreignKey({ columns: [t.userId, t.runId], foreignColumns: [modelRuns.userId, modelRuns.id] }),
    oneOf('decisions_stage', t.stage, STAGE_NAMES),
    oneOf('decisions_disposition', t.disposition, DISPOSITIONS),
    oneOf('decisions_subscription', t.subscription, SUBSCRIPTION_ACTIONS),
    oneOf('decisions_outcome', t.outcome, DECISION_OUTCOMES),
    check('decisions_settled_if_carried_out', sql`${t.carryOut} OR ${t.outcome} IS NULL`),
    index('decisions_message').on(t.accountId, t.messageId, t.id),
    index('decisions_time').on(t.accountId, t.decidedAt),
    index('decisions_run').on(t.userId, t.runId),
    index('decisions_rule')
      .on(t.accountId, t.ruleId, t.decidedAt)
      .where(sql`${t.ruleId} IS NOT NULL`),
    index('decisions_unsettled')
      .on(t.accountId)
      .where(sql`${t.carryOut} AND ${t.outcome} IS NULL`),
    index('decisions_prior')
      .on(t.priorRuleId, t.id)
      .where(sql`${t.priorRuleId} IS NOT NULL`),
    own(),
  ],
).enableRLS();

const decision = (t: { userId: AnyPgColumn; decisionId: AnyPgColumn }) =>
  foreignKey({ columns: [t.userId, t.decisionId], foreignColumns: [decisions.userId, decisions.id] });

/** The audit log. Intent is written before the provider call and the outcome after read-back, so every change can be undone. */
export const actions = pgTable(
  'actions',
  {
    id: id(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    messageId: text('message_id'),
    decisionId: integer('decision_id'), // null for changes made by hand and for undos
    type: text('type', { enum: ACTION_TYPES }).notNull(),
    payload: jsonb('payload').$type<ActionPayload>().notNull(),
    originalLabels: jsonb('original_labels').$type<string[]>().notNull(), // as read immediately before
    finalLabels: jsonb('final_labels').$type<string[]>(), // as read back afterwards
    status: text('status', { enum: ACTION_STATUSES }).notNull(),
    error: text('error'),
    createdAt: time('created_at').notNull(),
    completedAt: time('completed_at'),
  },
  (t) => [
    mailbox(t),
    message(t),
    decision(t),
    oneOf('actions_type', t.type, ACTION_TYPES),
    oneOf('actions_status', t.status, ACTION_STATUSES),
    index('actions_message').on(t.accountId, t.messageId),
    index('actions_time').on(t.accountId, t.createdAt),
    index('actions_open')
      .on(t.status)
      .where(sql`${t.status} IN ('pending', 'unknown')`),
    index('actions_decision').on(t.decisionId),
    own(),
  ],
).enableRLS();

/**
 * Conditions, then what mail is (label_id), what happens to it (disposition), or both; with when_label,
 * what happens only once a tier has said it is that label.
 */
export const rules = pgTable(
  'rules',
  {
    userId: userId(),
    id: text('id').notNull(),
    accountId: text('account_id').notNull(),
    position: integer('position').notNull(),
    match: jsonb('match').$type<RuleMatch>().notNull(),
    except: jsonb('except_matches').$type<RuleMatch[]>().notNull().default([]),
    labelId: text('label_id'),
    whenLabel: text('when_label'),
    disposition: text('disposition', { enum: DECIDED }),
    subscription: text('subscription', { enum: SUBSCRIPTION_ACTIONS }).notNull().default('preserve'),
    markRead: boolean('mark_read').notNull().default(false),
    condition: text('condition'), // a condition in the user's words; needs label_id
    source: text('source', { enum: RULE_SOURCES }).notNull(),
    hits: integer('hits').notNull().default(0),
    // The Gmail filter, while the user has it in Gmail too. filter_written is what each side last said,
    // as src/actions/rule-filters.ts keeps it.
    filterId: text('filter_id'),
    filterState: text('filter_state', { enum: FILTER_STATES }),
    filterWritten: jsonb('filter_written').$type<Record<string, unknown>>(),
    filterCheckedAt: time('filter_checked_at'),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    mailbox(t),
    label('rules_label', t, t.labelId),
    label('rules_when_label', t, t.whenLabel),
    oneOf('rules_disposition', t.disposition, DECIDED),
    oneOf('rules_subscription', t.subscription, SUBSCRIPTION_ACTIONS),
    oneOf('rules_source', t.source, RULE_SOURCES),
    oneOf('rules_filter_state', t.filterState, FILTER_STATES),
    check('rules_says_something', sql`${t.labelId} IS NOT NULL OR ${t.whenLabel} IS NOT NULL OR ${t.disposition} IS NOT NULL`),
    check('rules_label_or_wait', sql`${t.labelId} IS NULL OR ${t.whenLabel} IS NULL`),
    check('rules_condition_needs_label', sql`${t.condition} IS NULL OR ${t.labelId} IS NOT NULL`),
    index('rules_account').on(t.accountId, t.position),
    own(),
  ],
).enableRLS();

/** Rules sift thinks are worth having, waiting on the user. */
export const proposals = pgTable(
  'proposals',
  {
    id: id(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    kind: text('kind', { enum: PROPOSAL_KINDS }).notNull(),
    match: jsonb('match').$type<RuleMatch>().notNull(),
    labelId: text('label_id').notNull(),
    ruleId: text('rule_id'), // the judged rule an `always` would stop checking
    agreed: integer('agreed').notNull(), // how many decisions in a row it rests on
    status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('open'),
    createdAt: time('created_at').notNull(),
    resolvedAt: time('resolved_at'),
  },
  (t) => [
    mailbox(t),
    label('proposals_label', t, t.labelId),
    foreignKey({ columns: [t.userId, t.ruleId], foreignColumns: [rules.userId, rules.id] }).onDelete('cascade'),
    unique('proposals_once').on(t.userId, t.accountId, t.kind, t.match),
    oneOf('proposals_kind', t.kind, PROPOSAL_KINDS),
    oneOf('proposals_status', t.status, PROPOSAL_STATUSES),
    check('proposals_always_has_rule', sql`(${t.kind} = 'always') = (${t.ruleId} IS NOT NULL)`),
    own(),
  ],
).enableRLS();

/** Whether the owner has ever written to an address. Cached, because finding out is a mailbox search. */
export const correspondents = pgTable(
  'correspondents',
  {
    userId: userId(),
    accountId: text('account_id').notNull(),
    address: text('address').notNull(),
    userHasWritten: boolean('user_has_written').notNull(),
    checkedAt: time('checked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.accountId, t.address] }), mailbox(t), own()],
).enableRLS();

/** What the user said about a decision, one answer per decision: what the mail is, and what should happen to it. */
export const feedback = pgTable(
  'feedback',
  {
    id: id(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    decisionId: integer('decision_id').notNull(),
    verdict: text('verdict', { enum: VERDICTS }).notNull(),
    disposition: text('disposition', { enum: DECIDED }).notNull(),
    labelId: text('label_id'),
    via: text('via', { enum: FEEDBACK_VIA }).notNull(),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    unique('feedback_once').on(t.userId, t.decisionId),
    mailbox(t),
    decision(t),
    label('feedback_label', t, t.labelId),
    oneOf('feedback_verdict', t.verdict, VERDICTS),
    oneOf('feedback_disposition', t.disposition, DECIDED),
    oneOf('feedback_via', t.via, FEEDBACK_VIA),
    index('feedback_account').on(t.accountId, t.createdAt),
    own(),
  ],
).enableRLS();

/**
 * Mail the user answered for, kept whole as evaluation and training data. The dashboard cannot reach
 * Gmail, so answering creates the row and the next pass fetches the message into it.
 */
export const examples = pgTable(
  'examples',
  {
    userId: userId(),
    accountId: text('account_id').notNull(),
    messageId: text('message_id').notNull(),
    disposition: text('disposition', { enum: DECIDED }).notNull(),
    labelId: text('label_id'),
    markedAt: time('marked_at').notNull(),
    status: text('status', { enum: EXAMPLE_STATUSES }).notNull().default('pending'),
    bodyText: text('body_text'), // the readable text, as the model would be shown it
    bodyHtml: text('body_html'), // its HTML part as Gmail holds it, cleaned only when shown; null when it has none
    capturedAt: time('captured_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.accountId, t.messageId] }),
    mailbox(t),
    message(t),
    label('examples_label', t, t.labelId),
    oneOf('examples_disposition', t.disposition, DECIDED),
    oneOf('examples_status', t.status, EXAMPLE_STATUSES),
    index('examples_pending')
      .on(t.accountId)
      .where(sql`${t.status} = 'pending'`),
    own(),
  ],
).enableRLS();

/** The readable text of mail waiting on the user. Deleted when it is answered or stops being a suggestion, and after 30 days. */
export const suggestionBodies = pgTable(
  'suggestion_bodies',
  {
    userId: userId(),
    accountId: text('account_id').notNull(),
    messageId: text('message_id').notNull(),
    bodyText: text('body_text').notNull(), // as the model is shown it: plain text, truncated
    bodyHtml: text('body_html'), // its HTML part as Gmail holds it, cleaned only when shown; null when it has none
    fetchedAt: time('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.accountId, t.messageId] }), mailbox(t), message(t), own()],
).enableRLS();

/** A replay of the model over stored examples, with the settings it ran with: the same hashes mean the model was asked the same way. */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: id(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    startedAt: time('started_at').notNull(),
    finishedAt: time('finished_at'),
    status: text('status', { enum: EVAL_STATUSES }).notNull(),
    error: text('error'),
    model: text('model').notNull(),
    promptHash: text('prompt_hash').notNull(), // the system prompt and the layout around a message
    labelsHash: text('labels_hash').notNull(),
    labels: jsonb('labels').$type<{ id: string; name: string; description: string }[]>().notNull(), // as the model was given them
    fewShot: boolean('few_shot').notNull(),
    total: integer('total').notNull(),
    examples: jsonb('examples').$type<string[]>().notNull().default([]), // message ids of the examples it judges, chosen at the start
  },
  (t) => [unique('eval_runs_own').on(t.userId, t.id), mailbox(t), oneOf('eval_runs_status', t.status, EVAL_STATUSES), own()],
).enableRLS();

/** One row per example judged: labels and cost, no message content. */
export const evalResults = pgTable(
  'eval_results',
  {
    userId: userId(),
    runId: integer('run_id').notNull(),
    messageId: text('message_id').notNull(),
    expected: text('expected').notNull(), // the owner's label
    got: text('got'), // a label id or 'unsure'; null when the call failed
    error: text('error'), // why the call failed: its status and kind, never the provider's text
    confidence: doublePrecision('confidence'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    durationMs: integer('duration_ms').notNull(),
    shots: integer('shots').notNull(), // examples shown beside it
    senderShots: integer('sender_shots').notNull(), // of those, from the same sender
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.runId, t.messageId] }),
    foreignKey({ columns: [t.userId, t.runId], foreignColumns: [evalRuns.userId, evalRuns.id] }).onDelete('cascade'),
    own(),
  ],
).enableRLS();
