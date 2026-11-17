ALTER TABLE "proposals" DROP CONSTRAINT "proposals_once";--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_kind";--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_always_has_rule";--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_rule_has_action";--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_user_id_rule_id_rules_user_id_id_fk";
--> statement-breakpoint
DROP INDEX "decisions_prior";--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "disposition" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" DROP COLUMN "prior_rule_id";--> statement-breakpoint
ALTER TABLE "proposals" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "proposals" DROP COLUMN "rule_id";--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_once" UNIQUE("user_id","account_id","conditions");