-- Everything is scoped by account. Message bodies are never stored.

CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  history_id  TEXT,              -- Gmail history cursor; NULL forces a full sync
  created_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE messages (
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  id           TEXT NOT NULL,   -- provider message id
  thread_id    TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_domain  TEXT NOT NULL,
  list_id      TEXT,
  received_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
) STRICT;
CREATE INDEX messages_sender ON messages (account_id, from_address);

-- Tier 3: learned per-sender disposition.
CREATE TABLE senders (
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  address           TEXT NOT NULL,
  disposition       TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam')),
  label             TEXT,
  user_has_replied  INTEGER NOT NULL DEFAULT 0,
  replied_checked_at INTEGER,
  source            TEXT NOT NULL CHECK (source IN ('user', 'agent', 'correction')),
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (account_id, address)
) STRICT;

-- Tier 2: local rules. `match_json` / `except_json` hold RuleMatch objects.
CREATE TABLE rules (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  position      INTEGER NOT NULL,
  match_json    TEXT NOT NULL,
  except_json   TEXT NOT NULL DEFAULT '[]',
  disposition   TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam')),
  subscription  TEXT NOT NULL DEFAULT 'preserve' CHECK (subscription IN ('preserve', 'unsubscribe')),
  label         TEXT,
  source        TEXT NOT NULL CHECK (source IN ('user', 'agent', 'correction')),
  hits          INTEGER NOT NULL DEFAULT 0,
  filter_id     TEXT,            -- set once promoted to a Gmail filter
  created_at    INTEGER NOT NULL
) STRICT;
CREATE INDEX rules_account ON rules (account_id, position);

-- One row per triage outcome; the dedupe index for redelivered events.
CREATE TABLE decisions (
  account_id    TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  stage         TEXT NOT NULL,
  disposition   TEXT NOT NULL,
  subscription  TEXT NOT NULL,
  label         TEXT,
  rule_id       TEXT,
  confidence    REAL,
  reason        TEXT NOT NULL,
  decided_at    INTEGER NOT NULL,
  PRIMARY KEY (account_id, message_id),
  FOREIGN KEY (account_id, message_id) REFERENCES messages(account_id, id)
) STRICT;

-- Audit log. Intent is written before the provider call, outcome after read-back, so every action can be undone.
CREATE TABLE actions (
  id               INTEGER PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES accounts(id),
  message_id       TEXT,
  type             TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  original_labels  TEXT,          -- JSON array, as read immediately before the action
  final_labels     TEXT,          -- JSON array, as read back afterwards
  status           TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed', 'unknown', 'undone')),
  error            TEXT,
  created_at       INTEGER NOT NULL,
  completed_at     INTEGER
) STRICT;
CREATE INDEX actions_message ON actions (account_id, message_id);
CREATE INDEX actions_open ON actions (status) WHERE status IN ('pending', 'unknown');

-- "No match means ask": questions waiting on the user.
CREATE TABLE questions (
  id           INTEGER PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  scope_key    TEXT NOT NULL,     -- coalesces equivalent questions, e.g. sender:foo@example.com
  prompt       TEXT NOT NULL,
  answer       TEXT,
  asked_at     INTEGER NOT NULL,
  answered_at  INTEGER,
  UNIQUE (account_id, scope_key)
) STRICT;
