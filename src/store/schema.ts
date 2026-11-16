/**
 * The database, as Drizzle describes it. Change it here, then `pnpm db:generate` writes the migration
 * (into `src/store/migrations/`); never edit one that has been applied, and never write schema SQL by
 * hand anywhere else.
 *
 * Two kinds of table. `users` and `accounts` say who the people are and which mailboxes are whose, and
 * are read before anyone is known. Every other table holds one person's data: it carries their
 * `user_id`, which the handle sets (src/store/own.ts), and row-level security lets a transaction see and
 * write only that person's rows (src/store/sql.ts). Every key and foreign key between them includes
 * `user_id`, so no row can point at another person's. Deleting a person deletes everything of theirs.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
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
import { type Address, DECIDED, DISPOSITIONS, STAGE_NAMES, SUBSCRIPTION_ACTIONS } from '../triage/types.ts';
import type { ActionPayload } from './actions.ts';

export const CREDENTIAL_KINDS = ['gmail', 'model'] as const;
/** `observe`: recorded only. `act`: to be carried out; outcome is null until it has been. */
export const DECISION_MODES = ['act', 'observe'] as const;
export const DECISION_OUTCOMES = ['observed', 'none', 'done', 'skipped', 'failed', 'unknown'] as const;
export const ACTION_TYPES = ['archive', 'spam', 'label', 'undo', 'unsubscribe', 'filter', 'unfilter'] as const;
export const ACTION_STATUSES = ['pending', 'done', 'failed', 'unknown', 'undone'] as const;
export const RULE_SOURCES = ['user', 'agent', 'correction'] as const;
/** `changed`: edited in Gmail. `gone`: deleted there. `outdated`: the rule no longer says what the filter does. */
export const FILTER_STATES = ['active', 'changed', 'gone', 'outdated'] as const;
/** `rule`: make one for its match. `always`: stop checking a judged rule the model has agreed with every time. */
export const PROPOSAL_KINDS = ['rule', 'always'] as const;
export const PROPOSAL_STATUSES = ['open', 'accepted', 'dismissed'] as const;
/** right: sift's suggestion was what they wanted. wrong: it was not. answered: sift had no suggestion. */
export const VERDICTS = ['right', 'wrong', 'answered'] as const;
export const FEEDBACK_SCOPES = ['sender', 'message'] as const;
export const FEEDBACK_VIA = ['dashboard', 'gmail'] as const;
export const EXAMPLE_STATUSES = ['pending', 'captured', 'gone'] as const;
/** interrupted: sift stopped while it ran. */
export const EVAL_STATUSES = ['running', 'done', 'failed', 'interrupted'] as const;

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
const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });
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
  (t) => [index('accounts_user').on(t.userId)],
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
    createdAt: time('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), own()],
).enableRLS();

const mailbox = (t: { userId: AnyPgColumn; accountId: AnyPgColumn }) =>
  foreignKey({ columns: [t.userId, t.accountId], foreignColumns: [mailboxes.userId, mailboxes.id] });

/** Their own choices: the model their mail is judged with (`provider/model-id`). */
export const preferences = pgTable(
  'preferences',
  {
    userId: userId().primaryKey(),
    // false: their decisions are only suggestions. true: sift carries them out in their mailboxes.
    act: boolean('act').notNull().default(false),
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
    fromName: text('from_name'),
    listId: text('list_id'),
    receivedAt: time('received_at').notNull(),
    subject: text('subject').notNull().default(''),
    to: jsonb('to_addresses').$type<Address[]>().notNull().default([]),
    cc: jsonb('cc_addresses').$type<Address[]>().notNull().default([]),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}), // the triage headers only (see METADATA_HEADERS)
    labelIds: jsonb('label_ids').$type<string[]>().notNull().default([]), // when synced; a snapshot, not current state
    syncedAt: time('synced_at'),
    observeOnly: boolean('observe_only').notNull().default(false), // pulled in from before sift was connected: suggest, never act
    facts: jsonb('facts').$type<Facts>(), // null: derive from headers
    readAt: time('read_at'), // when a sync saw the user had opened it
  },
  (t) => [primaryKey({ columns: [t.userId, t.accountId, t.id] }), mailbox(t), index('messages_sender').on(t.accountId, t.fromAddress), own()],
).enableRLS();

const message = (t: { userId: AnyPgColumn; accountId: AnyPgColumn; messageId: AnyPgColumn }) =>
  foreignKey({ columns: [t.userId, t.accountId, t.messageId], foreignColumns: [messages.userId, messages.accountId, messages.id] });

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
    // What reaching it cost. Null model means no inference was used.
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    durationMs: integer('duration_ms'),
    decidedAt: time('decided_at').notNull(),
    mode: text('mode', { enum: DECISION_MODES }).notNull().default('observe'),
    outcome: text('outcome', { enum: DECISION_OUTCOMES }),
    outcomeDetail: text('outcome_detail'),
    byUser: boolean('by_user').notNull().default(false), // the user's own answer, carried out even while observing
  },
  (t) => [
    unique('decisions_own').on(t.userId, t.id),
    message(t),
    oneOf('decisions_stage', t.stage, STAGE_NAMES),
    oneOf('decisions_disposition', t.disposition, DISPOSITIONS),
    oneOf('decisions_subscription', t.subscription, SUBSCRIPTION_ACTIONS),
    oneOf('decisions_mode', t.mode, DECISION_MODES),
    oneOf('decisions_outcome', t.outcome, DECISION_OUTCOMES),
    index('decisions_message').on(t.accountId, t.messageId, t.id),
    index('decisions_time').on(t.decidedAt),
    index('decisions_unsettled')
      .on(t.accountId)
      .where(sql`${t.outcome} IS NULL`),
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
    originalLabels: jsonb('original_labels').$type<string[]>(), // as read immediately before
    finalLabels: jsonb('final_labels').$type<string[]>(), // as read back afterwards
    status: text('status', { enum: ACTION_STATUSES }).notNull(),
    error: text('error'),
    createdAt: time('created_at').notNull(),
    completedAt: time('completed_at'),
  },
  (t) => [
    mailbox(t),
    decision(t),
    oneOf('actions_type', t.type, ACTION_TYPES),
    oneOf('actions_status', t.status, ACTION_STATUSES),
    index('actions_message').on(t.accountId, t.messageId),
    index('actions_open')
      .on(t.status)
      .where(sql`${t.status} IN ('pending', 'unknown')`),
    index('actions_decision').on(t.decisionId),
    own(),
  ],
).enableRLS();

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
    ruleId: text('rule_id'),
    agreed: integer('agreed').notNull(), // how many decisions in a row it rests on
    status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('open'),
    createdAt: time('created_at').notNull(),
    resolvedAt: time('resolved_at'),
  },
  (t) => [
    mailbox(t),
    unique('proposals_once').on(t.userId, t.accountId, t.kind, t.match),
    oneOf('proposals_kind', t.kind, PROPOSAL_KINDS),
    oneOf('proposals_status', t.status, PROPOSAL_STATUSES),
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

/** What the user said about a suggestion, one answer per decision. `correct` is what should have happened. */
export const feedback = pgTable(
  'feedback',
  {
    id: id(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    decisionId: integer('decision_id').notNull(),
    messageId: text('message_id').notNull(),
    verdict: text('verdict', { enum: VERDICTS }).notNull(),
    correct: text('correct', { enum: DECIDED }),
    labelId: text('label_id'),
    scope: text('scope', { enum: FEEDBACK_SCOPES }).notNull(),
    via: text('via', { enum: FEEDBACK_VIA }).notNull().default('dashboard'),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    unique('feedback_once').on(t.userId, t.decisionId),
    mailbox(t),
    decision(t),
    oneOf('feedback_verdict', t.verdict, VERDICTS),
    oneOf('feedback_correct', t.correct, DECIDED),
    oneOf('feedback_scope', t.scope, FEEDBACK_SCOPES),
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
    suggested: text('suggested', { enum: DISPOSITIONS }).notNull(), // what sift had suggested, for scoring
    suggestedBy: text('suggested_by', { enum: STAGE_NAMES }).notNull(),
    markedAt: time('marked_at').notNull(),
    status: text('status', { enum: EXAMPLE_STATUSES }).notNull().default('pending'),
    raw: bytea('raw'), // the whole message as received (RFC 822)
    headers: jsonb('headers').$type<[string, string][]>(), // every header, in order
    bodyText: text('body_text'), // the readable text, as the model would be shown it
    capturedAt: time('captured_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.accountId, t.messageId] }),
    message(t),
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
    fetchedAt: time('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.accountId, t.messageId] }), message(t), own()],
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
