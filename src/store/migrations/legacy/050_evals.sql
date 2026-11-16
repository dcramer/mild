-- A replay of the model over stored examples, started by the user. The settings it ran with are kept
-- so two runs can be compared: the same hashes mean the model was asked the same way.
CREATE TABLE eval_runs (
  id               INTEGER PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES accounts(id),
  started_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  -- interrupted: sift stopped while it was running
  status           TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'interrupted')),
  error            TEXT,
  model            TEXT NOT NULL,
  prompt_hash      TEXT NOT NULL,     -- the system prompt and the layout around a message
  guidelines_hash  TEXT NOT NULL,
  labels_hash      TEXT NOT NULL,
  labels_json      TEXT NOT NULL,     -- [{id, name, description}] as the model was given them
  few_shot         INTEGER NOT NULL,
  total            INTEGER NOT NULL   -- examples in the run
) STRICT;

-- One row per example judged. No message content: the labels, and what the call cost.
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
