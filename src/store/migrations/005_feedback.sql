-- What the user said about a suggestion. One answer per decision.
--   right     sift's suggestion was what the user wanted
--   wrong     it was not; `correct` is what should have happened
--   answered  sift had no suggestion (left for review) and the user said what to do; not counted for accuracy
CREATE TABLE feedback (
  id           INTEGER PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  decision_id  INTEGER NOT NULL UNIQUE REFERENCES decisions(id),
  message_id   TEXT NOT NULL,
  verdict      TEXT NOT NULL CHECK (verdict IN ('right', 'wrong', 'answered')),
  correct      TEXT CHECK (correct IN ('keep', 'archive', 'spam')),
  -- Whether the answer was about this one message or everything from its sender.
  scope        TEXT NOT NULL CHECK (scope IN ('sender', 'message')),
  created_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX feedback_account ON feedback (account_id, created_at);

-- The category the user said the mail belongs to, when they gave one.
ALTER TABLE feedback ADD COLUMN category TEXT;

-- Mail the user has marked, kept whole as evaluation and training data. This is the one place sift
-- stores message content, and only for messages the user marked. The dashboard cannot reach Gmail, so
-- marking creates the row and the next pass of `sift run` fetches the message into it.
CREATE TABLE examples (
  account_id    TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  -- What the user said should happen, and the category if they named one.
  disposition   TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam')),
  category      TEXT,
  -- What sift had suggested, for scoring.
  suggested     TEXT NOT NULL,
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
