ALTER TABLE "examples" DROP CONSTRAINT "examples_disposition";--> statement-breakpoint
ALTER TABLE "model_runs" DROP CONSTRAINT "model_runs_outcome";--> statement-breakpoint
ALTER TABLE "credentials" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "examples" DROP COLUMN "disposition";--> statement-breakpoint
ALTER TABLE "examples" DROP COLUMN "captured_at";--> statement-breakpoint
ALTER TABLE "labels" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "mailboxes" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "model_runs" DROP COLUMN "outcome";