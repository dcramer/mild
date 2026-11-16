/**
 * The database, as Drizzle describes it. Change it here, then `pnpm db:generate` writes the migration
 * (into `src/store/migrations/`); never edit one that has been applied, and never write schema SQL by
 * hand anywhere else.
 *
 * Two kinds of table. `users` and `accounts` say who the people are and which mailboxes are whose, and
 * are read before anyone is known. Every other table holds one person's data: it carries their
 * `user_id`, filled in from the transaction's `sift.user` setting, and row-level security lets a
 * transaction see and write only that person's rows (`src/store/store.ts` sets it). Foreign keys
 * between them include `user_id`, so no row can point at another person's.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  serial,
  text,
  unique,
} from 'drizzle-orm/pg-core';

/** What sift's own queries run as: it owns nothing and cannot bypass row-level security. */
export const siftApp = pgRole('sift_app', { createRole: false });

// After a transaction that set it, the setting reads as '' for the rest of the session: that is nobody too.
const OWN = sql`user_id = nullif(current_setting('sift.user', true), '')::integer`;
/** Each person's table: only their rows, read or written. */
const own = () => pgPolicy('own', { for: 'all', to: siftApp, using: OWN, withCheck: OWN });

/** Milliseconds since the epoch. */
const time = (name: string) => bigint(name, { mode: 'number' });
const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });
const userId = () =>
  integer('user_id')
    .notNull()
    .default(sql`current_setting('sift.user')::integer`)
    .references((): AnyPgColumn => users.id);

// Who the people are and which mailboxes are whose.

/** A person. The first owns the install: only they may change what applies to all of it. */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  owner: integer('owner').notNull().default(0),
  createdAt: time('created_at').notNull(),
});

/** A mailbox, an identity someone signed in with. Its id is its address. It never changes hands. */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
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

/** Their own choices: the model their mail is judged with (`provider/model-id`), and their guidelines. */
export const preferences = pgTable(
  'preferences',
  {
    userId: userId().primaryKey(),
    model: text('model'),
    guidelines: text('guidelines'), // null: the starting ones, DEFAULT_GUIDELINES
    guidelinesChangedAt: time('guidelines_changed_at'),
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
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.key] }), check('credentials_kind', sql`${t.kind} IN ('gmail', 'model')`), own()],
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
    toJson: text('to_json').notNull().default('[]'), // Address[]
    ccJson: text('cc_json').notNull().default('[]'), // Address[]
    headersJson: text('headers_json').notNull().default('{}'), // the triage headers only (see METADATA_HEADERS)
    labelsJson: text('labels_json').notNull().default('[]'), // label ids when synced; a snapshot, not current state
    syncedAt: time('synced_at'),
    observeOnly: integer('observe_only').notNull().default(0), // pulled in from before sift was connected: suggest, never act
    factsJson: text('facts_json'), // `Facts` (src/triage/facts.ts); null: derive from headers_json
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
    id: serial('id').primaryKey(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    messageId: text('message_id').notNull(),
    stage: text('stage').notNull(),
    disposition: text('disposition').notNull(),
    subscription: text('subscription').notNull(),
    labelId: text('label_id'),
    gmailLabel: text('gmail_label'),
    block: integer('block').notNull().default(0),
    markRead: integer('mark_read').notNull().default(0),
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
    // `observe`: recorded only. `act`: to be carried out; outcome is null until it has been.
    mode: text('mode').notNull().default('observe'),
    outcome: text('outcome'),
    outcomeDetail: text('outcome_detail'),
    byUser: integer('by_user').notNull().default(0), // the user's own answer, carried out even while observing
  },
  (t) => [
    unique('decisions_own').on(t.userId, t.id),
    message(t),
    check('decisions_stage', sql`${t.stage} IN ('rules', 'sender', 'classifier', 'heuristics', 'agent', 'fallback')`),
    check('decisions_disposition', sql`${t.disposition} IN ('keep', 'archive', 'spam', 'review')`),
    check('decisions_subscription', sql`${t.subscription} IN ('preserve', 'unsubscribe')`),
    check('decisions_mode', sql`${t.mode} IN ('act', 'observe')`),
    check('decisions_outcome', sql`${t.outcome} IN ('observed', 'none', 'done', 'skipped', 'failed', 'unknown')`),
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
    id: serial('id').primaryKey(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    messageId: text('message_id'),
    decisionId: integer('decision_id'), // null for changes made by hand and for undos
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    originalLabels: text('original_labels'), // JSON array, as read immediately before
    finalLabels: text('final_labels'), // JSON array, as read back afterwards
    status: text('status').notNull(),
    error: text('error'),
    createdAt: time('created_at').notNull(),
    completedAt: time('completed_at'),
  },
  (t) => [
    mailbox(t),
    decision(t),
    check('actions_status', sql`${t.status} IN ('pending', 'done', 'failed', 'unknown', 'undone')`),
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
    disposition: text('disposition').notNull(),
    block: integer('block').notNull().default(0),
    markRead: integer('mark_read').notNull().default(0),
    unsubscribe: integer('unsubscribe').notNull().default(0),
    gmailLabel: text('gmail_label').notNull(),
    position: integer('position').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.accountId, t.id] }),
    mailbox(t),
    check('labels_disposition', sql`${t.disposition} IN ('keep', 'archive', 'spam', 'review')`),
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
    id: text('id').primaryKey(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    position: integer('position').notNull(),
    matchJson: text('match_json').notNull(),
    exceptJson: text('except_json').notNull().default('[]'),
    labelId: text('label_id'),
    whenLabel: text('when_label'),
    disposition: text('disposition'),
    subscription: text('subscription').notNull().default('preserve'),
    markRead: integer('mark_read').notNull().default(0),
    condition: text('condition'), // a condition in the user's words; needs label_id
    source: text('source').notNull(),
    hits: integer('hits').notNull().default(0),
    // The Gmail filter, while the user has it in Gmail too. `changed`: edited there. `gone`: deleted there.
    // `outdated`: the rule no longer says what the filter does. filter_json is what each side last said.
    filterId: text('filter_id'),
    filterState: text('filter_state'),
    filterJson: text('filter_json'),
    filterCheckedAt: time('filter_checked_at'),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    mailbox(t),
    check('rules_disposition', sql`${t.disposition} IN ('keep', 'archive', 'spam')`),
    check('rules_subscription', sql`${t.subscription} IN ('preserve', 'unsubscribe')`),
    check('rules_source', sql`${t.source} IN ('user', 'agent', 'correction')`),
    check('rules_filter_state', sql`${t.filterState} IN ('active', 'changed', 'gone', 'outdated')`),
    check('rules_says_something', sql`${t.labelId} IS NOT NULL OR ${t.whenLabel} IS NOT NULL OR ${t.disposition} IS NOT NULL`),
    check('rules_label_or_wait', sql`${t.labelId} IS NULL OR ${t.whenLabel} IS NULL`),
    check('rules_condition_needs_label', sql`${t.condition} IS NULL OR ${t.labelId} IS NOT NULL`),
    index('rules_account').on(t.accountId, t.position),
    own(),
  ],
).enableRLS();

/**
 * Rules sift thinks are worth having, waiting on the user. `rule`: make one for match_json. `always`:
 * stop checking rule_id, which the model has agreed with every time.
 */
export const proposals = pgTable(
  'proposals',
  {
    id: serial('id').primaryKey(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    kind: text('kind').notNull(),
    matchJson: text('match_json').notNull(),
    labelId: text('label_id').notNull(),
    ruleId: text('rule_id'),
    agreed: integer('agreed').notNull(), // how many decisions in a row it rests on
    status: text('status').notNull().default('open'),
    createdAt: time('created_at').notNull(),
    resolvedAt: time('resolved_at'),
  },
  (t) => [
    mailbox(t),
    unique('proposals_once').on(t.accountId, t.kind, t.matchJson),
    check('proposals_kind', sql`${t.kind} IN ('rule', 'always')`),
    check('proposals_status', sql`${t.status} IN ('open', 'accepted', 'dismissed')`),
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
    userHasWritten: integer('user_has_written').notNull(),
    checkedAt: time('checked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.address] }), mailbox(t), own()],
).enableRLS();

/**
 * What the user said about a suggestion, one answer per decision. right: sift's suggestion was what they
 * wanted. wrong: it was not; `correct` is what should have happened. answered: sift had no suggestion.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: serial('id').primaryKey(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    decisionId: integer('decision_id').notNull().unique(),
    messageId: text('message_id').notNull(),
    verdict: text('verdict').notNull(),
    correct: text('correct'),
    labelId: text('label_id'),
    scope: text('scope').notNull(),
    via: text('via').notNull().default('dashboard'),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    mailbox(t),
    decision(t),
    check('feedback_verdict', sql`${t.verdict} IN ('right', 'wrong', 'answered')`),
    check('feedback_correct', sql`${t.correct} IN ('keep', 'archive', 'spam')`),
    check('feedback_scope', sql`${t.scope} IN ('sender', 'message')`),
    check('feedback_via', sql`${t.via} IN ('dashboard', 'gmail')`),
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
    disposition: text('disposition').notNull(),
    labelId: text('label_id'),
    suggested: text('suggested').notNull(), // what sift had suggested, for scoring
    suggestedBy: text('suggested_by').notNull(),
    markedAt: time('marked_at').notNull(),
    status: text('status').notNull().default('pending'),
    raw: bytea('raw'), // the whole message as received (RFC 822)
    headersJson: text('headers_json'), // every header, in order, as [name, value] pairs
    bodyText: text('body_text'), // the readable text, as the model would be shown it
    capturedAt: time('captured_at'),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.messageId] }),
    message(t),
    check('examples_disposition', sql`${t.disposition} IN ('keep', 'archive', 'spam')`),
    check('examples_status', sql`${t.status} IN ('pending', 'captured', 'gone')`),
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
  (t) => [primaryKey({ columns: [t.accountId, t.messageId] }), message(t), own()],
).enableRLS();

/** A replay of the model over stored examples, with the settings it ran with: the same hashes mean the model was asked the same way. */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: serial('id').primaryKey(),
    userId: userId(),
    accountId: text('account_id').notNull(),
    startedAt: time('started_at').notNull(),
    finishedAt: time('finished_at'),
    status: text('status').notNull(), // interrupted: sift stopped while it ran
    error: text('error'),
    model: text('model').notNull(),
    promptHash: text('prompt_hash').notNull(), // the system prompt and the layout around a message
    guidelinesHash: text('guidelines_hash').notNull(),
    labelsHash: text('labels_hash').notNull(),
    labelsJson: text('labels_json').notNull(), // [{id, name, description}] as the model was given them
    fewShot: integer('few_shot').notNull(),
    total: integer('total').notNull(),
  },
  (t) => [
    unique('eval_runs_own').on(t.userId, t.id),
    mailbox(t),
    check('eval_runs_status', sql`${t.status} IN ('running', 'done', 'failed', 'interrupted')`),
    own(),
  ],
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
    primaryKey({ columns: [t.runId, t.messageId] }),
    foreignKey({ columns: [t.userId, t.runId], foreignColumns: [evalRuns.userId, evalRuns.id] }).onDelete('cascade'),
    own(),
  ],
).enableRLS();
