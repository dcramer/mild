ALTER TABLE "decisions" DROP CONSTRAINT "decisions_stage";--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "act" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_stage" CHECK ("decisions"."stage" IN ('rules', 'sender', 'classifier', 'agent', 'fallback'));