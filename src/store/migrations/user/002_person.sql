-- Whose database this is: written the first time it is opened, and checked every time after, so a file
-- moved, renamed or restored to the wrong place is refused instead of served as someone else's.
CREATE TABLE person (
  one  INTEGER PRIMARY KEY CHECK (one = 1),
  id   INTEGER NOT NULL
) STRICT;
