-- Each person's earliest connected mailbox is their primary one, as removing one picks the next (`removeMailbox`).
UPDATE "accounts" SET "primary" = true
WHERE "id" IN (SELECT DISTINCT ON ("user_id") "id" FROM "accounts" ORDER BY "user_id", "created_at", "id")
AND NOT EXISTS (SELECT 1 FROM "accounts" other WHERE other."user_id" = "accounts"."user_id" AND other."primary");
