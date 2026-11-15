-- The readable text of mail that is waiting on the user, so a suggestion can be judged by reading it.
-- Temporary by design: a row goes when its message is answered or stops being a suggestion, and
-- after 30 days whatever happened. Mail the user answers is kept whole in `examples` instead.
CREATE TABLE suggestion_bodies (
  account_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  body_text   TEXT NOT NULL,     -- as the model is shown it: plain text, truncated
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, message_id),
  FOREIGN KEY (account_id, message_id) REFERENCES messages(account_id, id)
) STRICT;
