-- A rule is `always` (decides by itself) or `usually` (a prior the model is given, and may overrule for one message).
-- `condition` is a soft rule's plain-language "when"; a rule that has one is always judged by the model.
ALTER TABLE rules ADD COLUMN tier TEXT NOT NULL DEFAULT 'always' CHECK (tier IN ('always', 'usually'));
ALTER TABLE rules ADD COLUMN condition TEXT;

-- The judged rule the model was shown, whether or not it agreed. `rule_id` is set only when it did.
ALTER TABLE decisions ADD COLUMN prior_rule_id TEXT;
CREATE INDEX decisions_prior ON decisions (prior_rule_id, id) WHERE prior_rule_id IS NOT NULL;

-- Rules sift thinks are worth having, waiting on the user. `rule`: make one for `match_json`.
-- `always`: stop checking `rule_id`, which the model has agreed with every time.
CREATE TABLE proposals (
  id          INTEGER PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  kind        TEXT NOT NULL CHECK (kind IN ('rule', 'always')),
  match_json  TEXT NOT NULL,
  label_id    TEXT NOT NULL,
  rule_id     TEXT,
  agreed      INTEGER NOT NULL,   -- how many decisions in a row it rests on
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE (account_id, kind, match_json)
) STRICT;
