-- What this person has chosen for their own mail: the model it is judged with (`provider/model-id`, NULL
-- for none), and their guidelines, which the model reads as their instructions. NULL guidelines: the
-- starting ones in src/store/preferences.ts.
CREATE TABLE preferences (
  one                    INTEGER PRIMARY KEY CHECK (one = 1),
  model                  TEXT,
  guidelines             TEXT,
  guidelines_changed_at  INTEGER
) STRICT;
INSERT INTO preferences (one) VALUES (1);
