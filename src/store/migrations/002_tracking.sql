-- Keep enough about every message to triage it again and to show what sift did, without the body.

ALTER TABLE messages ADD COLUMN subject TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN from_name TEXT;
ALTER TABLE messages ADD COLUMN to_json TEXT NOT NULL DEFAULT '[]';        -- Address[]
ALTER TABLE messages ADD COLUMN cc_json TEXT NOT NULL DEFAULT '[]';        -- Address[]
ALTER TABLE messages ADD COLUMN headers_json TEXT NOT NULL DEFAULT '{}';   -- the triage headers only (see METADATA_HEADERS)
ALTER TABLE messages ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]';    -- label ids when synced; a snapshot, not current state
ALTER TABLE messages ADD COLUMN synced_at INTEGER;

ALTER TABLE accounts ADD COLUMN last_synced_at INTEGER;

-- Decisions become an append-only log: a message can be decided more than once (retries, corrections,
-- policy changes). The current decision for a message is the one with the highest id.
DROP TABLE decisions;
CREATE TABLE decisions (
  id             INTEGER PRIMARY KEY,
  account_id     TEXT NOT NULL,
  message_id     TEXT NOT NULL,
  stage          TEXT NOT NULL CHECK (stage IN ('rules', 'sender', 'classifier', 'agent', 'fallback')),
  disposition    TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam', 'review')),
  subscription   TEXT NOT NULL CHECK (subscription IN ('preserve', 'unsubscribe')),
  label          TEXT,
  rule_id        TEXT,
  confidence     REAL,
  reason         TEXT NOT NULL,
  -- What reaching this decision cost. NULL model means no inference was used.
  model          TEXT,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  duration_ms    INTEGER,
  decided_at     INTEGER NOT NULL,
  FOREIGN KEY (account_id, message_id) REFERENCES messages(account_id, id)
) STRICT;
CREATE INDEX decisions_message ON decisions (account_id, message_id, id);
CREATE INDEX decisions_time ON decisions (decided_at);

-- Which decision an action carried out. NULL for actions applied by hand and for undos.
ALTER TABLE actions ADD COLUMN decision_id INTEGER REFERENCES decisions(id);
CREATE INDEX actions_decision ON actions (decision_id);
