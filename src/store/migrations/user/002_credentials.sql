-- This person's sign-ins, each encrypted for its row with SIFT_KEY when there is one (src/secrets.ts).
-- `gmail`: a mailbox's refresh token, keyed by address. `model`: a model provider's credential, keyed
-- by provider id.
CREATE TABLE credentials (
  kind        TEXT NOT NULL CHECK (kind IN ('gmail', 'model')),
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
) STRICT;
