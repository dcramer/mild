-- What to do with each kind of mail. The model only names a category; the disposition comes from this
-- table, so the user's choice (not the model) decides what happens.
CREATE TABLE categories (
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,      -- how to recognise it; shown to the model
  disposition  TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam', 'review')),
  label        TEXT,
  position     INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, key)
) STRICT;

-- Whether the account owner has ever written to an address. Cached, because finding out is a mailbox search.
CREATE TABLE correspondents (
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  address           TEXT NOT NULL,
  user_has_written  INTEGER NOT NULL,
  checked_at        INTEGER NOT NULL,
  PRIMARY KEY (account_id, address)
) STRICT;

ALTER TABLE decisions ADD COLUMN category TEXT;
ALTER TABLE senders ADD COLUMN category TEXT;
