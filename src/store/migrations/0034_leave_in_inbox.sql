-- Everything Else is now Leave in inbox, with a name of its own that does not change. Its description becomes
-- what the person says always stays in their inbox: the old default said nothing of theirs, so it goes.
UPDATE "labels" SET
  "name" = 'Leave in inbox',
  "description" = CASE WHEN "description" = 'Mail that is plainly none of the other labels.' THEN '' ELSE "description" END
WHERE "id" = 'everything_else';
