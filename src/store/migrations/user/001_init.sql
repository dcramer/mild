-- One person's database: everything about their mail. Who owns which mailbox is the install's database's
-- to say; `mailboxes` here is this person's copy, which the rest refers to. Every row still names its
-- mailbox, since a person can have several. Message bodies are stored only in `examples` and
-- `suggestion_bodies`.

-- Whose database this is: written the first time it is opened, and checked every time after, so a file
-- moved, renamed or restored to the wrong place is refused instead of served as someone else's.
CREATE TABLE person (
  one  INTEGER PRIMARY KEY CHECK (one = 1),
  id   INTEGER NOT NULL
) STRICT;

CREATE TABLE mailboxes (
  id                  TEXT PRIMARY KEY,   -- the address
  history_id          TEXT,               -- Gmail history cursor; NULL forces a full sync
  last_synced_at      INTEGER,
  filters_checked_at  INTEGER,
  created_at          INTEGER NOT NULL
) STRICT;

-- Every message sift has seen, without the body: enough to triage it again and show what sift did.
CREATE TABLE messages (
  account_id    TEXT NOT NULL REFERENCES mailboxes(id),
  id            TEXT NOT NULL,                  -- provider message id
  thread_id     TEXT NOT NULL,
  from_address  TEXT NOT NULL,
  from_domain   TEXT NOT NULL,
  from_name     TEXT,
  list_id       TEXT,
  received_at   INTEGER NOT NULL,
  subject       TEXT NOT NULL DEFAULT '',
  to_json       TEXT NOT NULL DEFAULT '[]',     -- Address[]
  cc_json       TEXT NOT NULL DEFAULT '[]',     -- Address[]
  headers_json  TEXT NOT NULL DEFAULT '{}',     -- the triage headers only (see METADATA_HEADERS)
  labels_json   TEXT NOT NULL DEFAULT '[]',     -- label ids when synced; a snapshot, not current state
  synced_at     INTEGER,
  observe_only  INTEGER NOT NULL DEFAULT 0,     -- pulled in from before sift was connected: suggest, never act
  facts_json    TEXT,                           -- `Facts` (src/triage/facts.ts); NULL: derive from headers_json
  read_at       INTEGER,                        -- when a sync saw the user had opened it; NULL: not known to have been
  PRIMARY KEY (account_id, id)
) STRICT;
CREATE INDEX messages_sender ON messages (account_id, from_address);

-- An append-only log: a message can be decided more than once, and the highest id is current.
CREATE TABLE decisions (
  id              INTEGER PRIMARY KEY,
  account_id      TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  stage           TEXT NOT NULL CHECK (stage IN ('rules', 'sender', 'classifier', 'heuristics', 'agent', 'fallback')),
  disposition     TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam', 'review')),
  subscription    TEXT NOT NULL CHECK (subscription IN ('preserve', 'unsubscribe')),
  label_id        TEXT,
  gmail_label     TEXT,
  block           INTEGER NOT NULL DEFAULT 0,
  mark_read       INTEGER NOT NULL DEFAULT 0,
  rule_id         TEXT,
  prior_rule_id   TEXT,                         -- the judged rule the model was shown, whether or not it agreed
  confidence      REAL,
  reason          TEXT NOT NULL,
  -- What reaching it cost. NULL model means no inference was used.
  model           TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  decided_at      INTEGER NOT NULL,
  -- `observe`: recorded only. `act`: to be carried out; outcome is NULL until it has been.
  mode            TEXT NOT NULL DEFAULT 'observe' CHECK (mode IN ('act', 'observe')),
  outcome         TEXT CHECK (outcome IN ('observed', 'none', 'done', 'skipped', 'failed', 'unknown')),
  outcome_detail  TEXT,
  by_user         INTEGER NOT NULL DEFAULT 0 CHECK (by_user IN (0, 1)),  -- the user's own answer, carried out even while observing
  FOREIGN KEY (account_id, message_id) REFERENCES messages(account_id, id)
) STRICT;
CREATE INDEX decisions_message ON decisions (account_id, message_id, id);
CREATE INDEX decisions_time ON decisions (decided_at);
CREATE INDEX decisions_unsettled ON decisions (account_id) WHERE outcome IS NULL;
CREATE INDEX decisions_prior ON decisions (prior_rule_id, id) WHERE prior_rule_id IS NOT NULL;

-- The audit log. Intent is written before the provider call and the outcome after read-back, so every change can be undone.
CREATE TABLE actions (
  id               INTEGER PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES mailboxes(id),
  message_id       TEXT,
  decision_id      INTEGER REFERENCES decisions(id),   -- NULL for changes made by hand and for undos
  type             TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  original_labels  TEXT,          -- JSON array, as read immediately before
  final_labels     TEXT,          -- JSON array, as read back afterwards
  status           TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed', 'unknown', 'undone')),
  error            TEXT,
  created_at       INTEGER NOT NULL,
  completed_at     INTEGER
) STRICT;
CREATE INDEX actions_message ON actions (account_id, message_id);
CREATE INDEX actions_open ON actions (status) WHERE status IN ('pending', 'unknown');
CREATE INDEX actions_decision ON actions (decision_id);

-- What mail can be, and what sift does with each.
CREATE TABLE labels (
  account_id   TEXT NOT NULL REFERENCES mailboxes(id),
  id           TEXT NOT NULL,      -- stable; the name can change without orphaning history
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,      -- how to recognise it; shown to the model
  disposition  TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam', 'review')),
  block        INTEGER NOT NULL DEFAULT 0,
  mark_read    INTEGER NOT NULL DEFAULT 0,
  unsubscribe  INTEGER NOT NULL DEFAULT 0,
  gmail_label  TEXT NOT NULL,
  position     INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
) STRICT;

-- Conditions, then what mail is (label_id), what happens to it (disposition), or both; with when_label,
-- what happens only once a tier has said it is that label.
CREATE TABLE rules (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES mailboxes(id),
  position           INTEGER NOT NULL,
  match_json         TEXT NOT NULL,
  except_json        TEXT NOT NULL DEFAULT '[]',
  label_id           TEXT,
  when_label         TEXT,
  disposition        TEXT CHECK (disposition IN ('keep', 'archive', 'spam')),
  subscription       TEXT NOT NULL DEFAULT 'preserve' CHECK (subscription IN ('preserve', 'unsubscribe')),
  mark_read          INTEGER NOT NULL DEFAULT 0,
  condition          TEXT,            -- a condition in the user's words; needs label_id
  source             TEXT NOT NULL CHECK (source IN ('user', 'agent', 'correction')),
  hits               INTEGER NOT NULL DEFAULT 0,
  -- The Gmail filter, while the user has it in Gmail too. `changed`: edited there. `gone`: deleted there.
  -- `outdated`: the rule no longer says what the filter does. filter_json is what each side last said.
  filter_id          TEXT,
  filter_state       TEXT CHECK (filter_state IN ('active', 'changed', 'gone', 'outdated')),
  filter_json        TEXT,
  filter_checked_at  INTEGER,
  created_at         INTEGER NOT NULL,
  CHECK (label_id IS NOT NULL OR when_label IS NOT NULL OR disposition IS NOT NULL),
  CHECK (label_id IS NULL OR when_label IS NULL),
  CHECK (condition IS NULL OR label_id IS NOT NULL)
) STRICT;
CREATE INDEX rules_account ON rules (account_id, position);

-- Rules sift thinks are worth having, waiting on the user. `rule`: make one for match_json.
-- `always`: stop checking rule_id, which the model has agreed with every time.
CREATE TABLE proposals (
  id           INTEGER PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES mailboxes(id),
  kind         TEXT NOT NULL CHECK (kind IN ('rule', 'always')),
  match_json   TEXT NOT NULL,
  label_id     TEXT NOT NULL,
  rule_id      TEXT,
  agreed       INTEGER NOT NULL,   -- how many decisions in a row it rests on
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  UNIQUE (account_id, kind, match_json)
) STRICT;

-- Whether the owner has ever written to an address. Cached, because finding out is a mailbox search.
CREATE TABLE correspondents (
  account_id        TEXT NOT NULL REFERENCES mailboxes(id),
  address           TEXT NOT NULL,
  user_has_written  INTEGER NOT NULL,
  checked_at        INTEGER NOT NULL,
  PRIMARY KEY (account_id, address)
) STRICT;

-- What the user said about a suggestion, one answer per decision.
--   right: sift's suggestion was what they wanted. wrong: it was not; `correct` is what should have happened.
--   answered: sift had no suggestion; not counted for accuracy.
CREATE TABLE feedback (
  id           INTEGER PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES mailboxes(id),
  decision_id  INTEGER NOT NULL UNIQUE REFERENCES decisions(id),
  message_id   TEXT NOT NULL,
  verdict      TEXT NOT NULL CHECK (verdict IN ('right', 'wrong', 'answered')),
  correct      TEXT CHECK (correct IN ('keep', 'archive', 'spam')),
  label_id     TEXT,
  scope        TEXT NOT NULL CHECK (scope IN ('sender', 'message')),
  via          TEXT NOT NULL DEFAULT 'dashboard' CHECK (via IN ('dashboard', 'gmail')),
  created_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX feedback_account ON feedback (account_id, created_at);

-- Mail the user answered for, kept whole as evaluation and training data. The dashboard cannot reach
-- Gmail, so answering creates the row and the next pass of `sift run` fetches the message into it.
CREATE TABLE examples (
  account_id    TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  disposition   TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam')),
  label_id      TEXT,
  suggested     TEXT NOT NULL,   -- what sift had suggested, for scoring
  suggested_by  TEXT NOT NULL,
  marked_at     INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'captured', 'gone')),
  raw           BLOB,     -- the whole message as received (RFC 822)
  headers_json  TEXT,     -- every header, in order, as [name, value] pairs
  body_text     TEXT,     -- the readable text, as the model would be shown it
  captured_at   INTEGER,
  PRIMARY KEY (account_id, message_id),
  FOREIGN KEY (account_id, message_id) REFERENCES messages(account_id, id)
) STRICT;
CREATE INDEX examples_pending ON examples (account_id) WHERE status = 'pending';

-- The readable text of mail waiting on the user. Deleted when it is answered or stops being a
-- suggestion, and after 30 days whatever happened.
CREATE TABLE suggestion_bodies (
  account_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  body_text   TEXT NOT NULL,     -- as the model is shown it: plain text, truncated
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, message_id),
  FOREIGN KEY (account_id, message_id) REFERENCES messages(account_id, id)
) STRICT;

-- A replay of the model over stored examples, with the settings it ran with: the same hashes mean the
-- model was asked the same way.
CREATE TABLE eval_runs (
  id               INTEGER PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES mailboxes(id),
  started_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  status           TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'interrupted')),  -- interrupted: sift stopped while it ran
  error            TEXT,
  model            TEXT NOT NULL,
  prompt_hash      TEXT NOT NULL,     -- the system prompt and the layout around a message
  guidelines_hash  TEXT NOT NULL,
  labels_hash      TEXT NOT NULL,
  labels_json      TEXT NOT NULL,     -- [{id, name, description}] as the model was given them
  few_shot         INTEGER NOT NULL,
  total            INTEGER NOT NULL
) STRICT;

-- One row per example judged: labels and cost, no message content.
CREATE TABLE eval_results (
  run_id         INTEGER NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  message_id     TEXT NOT NULL,
  expected       TEXT NOT NULL,     -- the owner's label
  got            TEXT,              -- a label id or 'unsure'; NULL when the call failed
  confidence     REAL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL,
  shots          INTEGER NOT NULL,  -- examples shown beside it
  sender_shots   INTEGER NOT NULL,  -- of those, from the same sender
  PRIMARY KEY (run_id, message_id)
) STRICT;
