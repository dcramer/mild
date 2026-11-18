DROP INDEX "actions_message";--> statement-breakpoint
DROP INDEX "decisions_rule";--> statement-breakpoint
DROP INDEX "model_runs_rule";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "decided" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "actions_filters" ON "actions" USING btree ("user_id","account_id","id") WHERE "actions"."type" IN ('filter', 'unfilter');--> statement-breakpoint
CREATE INDEX "messages_undecided" ON "messages" USING btree ("account_id","received_at") WHERE NOT "messages"."decided";--> statement-breakpoint
CREATE INDEX "actions_message" ON "actions" USING btree ("user_id","account_id","message_id");--> statement-breakpoint
CREATE INDEX "decisions_rule" ON "decisions" USING btree ("user_id","rule_id","decided_at") WHERE "decisions"."rule_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "model_runs_rule" ON "model_runs" USING btree ("user_id","rule_id","started_at") WHERE "model_runs"."rule_id" IS NOT NULL;