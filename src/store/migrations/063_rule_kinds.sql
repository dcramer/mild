-- A rule now says what mail is (label_id), what happens to it (disposition), or both; or, with when_label,
-- what happens only when a tier has said it is that label. So label_id may be NULL. `tier` goes:
-- a `usually` rule was "this sender is usually L, and the model checks", which is a rule that waits for L.
CREATE TABLE rules_new (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  position          INTEGER NOT NULL,
  match_json        TEXT NOT NULL,
  except_json       TEXT NOT NULL DEFAULT '[]',
  label_id          TEXT,
  when_label        TEXT,
  disposition       TEXT CHECK (disposition IN ('keep', 'archive', 'spam')),
  subscription      TEXT NOT NULL DEFAULT 'preserve' CHECK (subscription IN ('preserve', 'unsubscribe')),
  mark_read         INTEGER NOT NULL DEFAULT 0,
  condition         TEXT,            -- a condition in the user's words; needs label_id
  source            TEXT NOT NULL CHECK (source IN ('user', 'agent', 'correction')),
  hits              INTEGER NOT NULL DEFAULT 0,
  filter_id         TEXT,
  filter_state      TEXT CHECK (filter_state IN ('active', 'changed', 'gone', 'outdated')),
  filter_json       TEXT,
  filter_checked_at INTEGER,
  created_at        INTEGER NOT NULL,
  CHECK (label_id IS NOT NULL OR when_label IS NOT NULL OR disposition IS NOT NULL),
  CHECK (label_id IS NULL OR when_label IS NULL),
  CHECK (condition IS NULL OR label_id IS NOT NULL)
) STRICT;

INSERT INTO rules_new
  (id, account_id, position, match_json, except_json, label_id, when_label, disposition, subscription, mark_read, condition,
   source, hits, filter_id, filter_state, filter_json, filter_checked_at, created_at)
SELECT id, account_id, position, match_json, except_json,
       CASE WHEN tier = 'usually' AND condition IS NULL THEN NULL ELSE label_id END,
       CASE WHEN tier = 'usually' AND condition IS NULL THEN label_id END,
       disposition, subscription, mark_read, condition, source, hits, filter_id, filter_state, filter_json, filter_checked_at, created_at
FROM rules;

DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;
CREATE INDEX rules_account ON rules (account_id, position);

-- A proposal to stop checking a rule is now a proposal to drop its "when it is L".
