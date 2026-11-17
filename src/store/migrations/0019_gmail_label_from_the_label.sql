ALTER TABLE "eval_runs" DROP CONSTRAINT "eval_runs_status";--> statement-breakpoint
ALTER TABLE "decisions" DROP COLUMN "gmail_label";--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_status" CHECK ("eval_runs"."status" IN ('running', 'done', 'failed'));