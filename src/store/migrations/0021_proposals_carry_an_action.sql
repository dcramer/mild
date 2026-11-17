ALTER TABLE "proposals" ADD COLUMN "disposition" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_rule_has_action" CHECK (("proposals"."kind" = 'rule') = ("proposals"."disposition" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_disposition" CHECK ("proposals"."disposition" IN ('keep', 'archive', 'spam'));