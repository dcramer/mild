-- A rule that only leaves mail in the inbox is Leave in inbox (`leaveInInbox`, src/store/rules.ts), as the
-- rule dialog and Trust now make it: one form, which also counts as trusting a sender. One with an extra stays.
UPDATE "rules" SET "label_id" = 'everything_else', "disposition" = NULL
WHERE "label_id" IS NULL AND "when_label" IS NULL AND "disposition" = 'keep' AND NOT "mark_read" AND "subscription" = 'preserve';
