-- Sift is Mild: its labels in Gmail are mild/…, which src/gmail/mailbox.ts renames there the first time a pass needs one.
-- Row-level security would hide every person's labels from the tables' owner running this.
ALTER TABLE "labels" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "labels" SET "gmail_label" = 'mild' || substr("gmail_label", 5) WHERE "gmail_label" LIKE 'sift/%';--> statement-breakpoint
ALTER TABLE "labels" FORCE ROW LEVEL SECURITY;
