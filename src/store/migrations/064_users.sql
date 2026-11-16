-- A user is a person; an account is one of their mailboxes (an identity they signed in with). What a
-- signed-in person may see is their own accounts and nothing else. The first user owns the install:
-- only they may change what applies to all of it.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  owner      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;

ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id);

-- Until now an account could only be connected by someone already signed in, so every account there is
-- belongs to whoever connected the first.
INSERT INTO users (id, owner, created_at) SELECT 1, 1, min(created_at) FROM accounts HAVING count(*) > 0;
UPDATE accounts SET user_id = 1;
CREATE INDEX accounts_user ON accounts (user_id);
