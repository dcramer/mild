DROP INDEX "inbox_runs_one_going";--> statement-breakpoint
ALTER TABLE "inbox_runs" ADD COLUMN "rule_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_runs_one_going" ON "inbox_runs" USING btree ("user_id","account_id",coalesce("rule_id", '')) WHERE "inbox_runs"."finished_at" IS NULL;