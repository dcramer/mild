-- Mail recorded before `messages.decided` says so from its decisions. Every person's rows at once, so the tables'
-- owner, which migrates on a Postgres server, is let past their policies until the end of the migration.
ALTER TABLE "messages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "messages" m SET "decided" = true
WHERE EXISTS (SELECT 1 FROM "decisions" d WHERE d."user_id" = m."user_id" AND d."account_id" = m."account_id" AND d."message_id" = m."id");--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions" FORCE ROW LEVEL SECURITY;
