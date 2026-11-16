-- The install's own database: who the people are and which mailboxes are whose. Everything about their
-- mail is in each person's own database (migrations/user/).

-- A person. The first owns the install: only they may change what applies to all of it.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  owner      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;

-- A mailbox, an identity someone signed in with. Its id is its address. It never changes hands.
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX accounts_user ON accounts (user_id);
