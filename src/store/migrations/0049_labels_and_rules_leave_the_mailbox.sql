ALTER TABLE "rules" DROP CONSTRAINT "rules_filter_state";--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_user_id_account_id_mailboxes_user_id_id_fk";
--> statement-breakpoint
ALTER TABLE "rules" DROP CONSTRAINT "rules_user_id_account_id_mailboxes_user_id_id_fk";
--> statement-breakpoint
DROP INDEX "rules_account";--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_user_id_account_id_id_pk";--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_user_id_id_pk" PRIMARY KEY("user_id","id");--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_label" FOREIGN KEY ("user_id","label_id") REFERENCES "public"."labels"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examples" ADD CONSTRAINT "examples_label" FOREIGN KEY ("user_id","label_id") REFERENCES "public"."labels"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_label" FOREIGN KEY ("user_id","label_id") REFERENCES "public"."labels"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_label" FOREIGN KEY ("user_id","label_id") REFERENCES "public"."labels"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_label" FOREIGN KEY ("user_id","label_id") REFERENCES "public"."labels"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_when_label" FOREIGN KEY ("user_id","when_label") REFERENCES "public"."labels"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rules_order" ON "rules" USING btree ("user_id","position");--> statement-breakpoint
ALTER TABLE "labels" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "filter_id";--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "filter_state";--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "filter_written";--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "filter_checked_at";