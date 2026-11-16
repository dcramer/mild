-- Let a decision name the heuristics tier. SQLite cannot alter a CHECK, and rebuilding `decisions` would
-- have to list every column added since; editing the stored definition changes only the constraint.
-- SQLite documents this for changes that leave the stored rows as they are.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
   SET sql = replace(sql, '''classifier'', ''agent''', '''classifier'', ''heuristics'', ''agent''')
 WHERE type = 'table' AND name = 'decisions';
PRAGMA writable_schema = RESET;
