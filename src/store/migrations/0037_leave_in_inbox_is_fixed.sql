-- Leave in inbox does not change, and has no words of the person's: mail to treat differently gets a label of
-- their own. What was written there before is no longer read.
UPDATE "labels" SET "description" = '' WHERE "id" = 'everything_else';
