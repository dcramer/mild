-- Everything Else came with new mailboxes only (0022); mailboxes made before it get it here, as
-- `everythingElseRow` (src/store/labels.ts) writes it, after every label of theirs.
INSERT INTO "labels" ("user_id", "account_id", "id", "name", "description", "disposition", "gmail_label", "position")
SELECT "user_id", "id", 'everything_else', 'Everything Else', 'Mail that is plainly none of the other labels.', 'keep', NULL, 30
FROM "mailboxes"
ON CONFLICT DO NOTHING;
