-- A mailbox connected after the person had labels was set up again. One with none of its own now gets the
-- labels of their other mailboxes, as `labelsOfTheirOtherMailboxes` (src/store/labels.ts) gives them.
INSERT INTO "labels" ("user_id", "account_id", "id", "name", "description", "disposition", "block", "mark_read", "unsubscribe", "gmail_label", "position")
SELECT bare."user_id", bare."id", theirs."id", theirs."name", theirs."description", theirs."disposition", theirs."block", theirs."mark_read", theirs."unsubscribe", theirs."gmail_label",
  (row_number() OVER (PARTITION BY bare."user_id", bare."id" ORDER BY theirs."account_id", theirs."position", theirs."id"))::integer - 1
FROM "mailboxes" bare
JOIN (
  SELECT DISTINCT ON ("user_id", "id") * FROM "labels"
  WHERE "id" <> 'everything_else' AND "removed_at" IS NULL
  ORDER BY "user_id", "id", "account_id", "position"
) theirs ON theirs."user_id" = bare."user_id" AND theirs."account_id" <> bare."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "labels" own
  WHERE own."user_id" = bare."user_id" AND own."account_id" = bare."id" AND own."id" <> 'everything_else' AND own."removed_at" IS NULL
)
ON CONFLICT ("user_id", "account_id", "id") DO UPDATE SET
  "name" = excluded."name", "description" = excluded."description", "disposition" = excluded."disposition", "block" = excluded."block",
  "mark_read" = excluded."mark_read", "unsubscribe" = excluded."unsubscribe", "position" = excluded."position", "removed_at" = NULL;
