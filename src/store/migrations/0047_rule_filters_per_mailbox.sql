CREATE TABLE "rule_filters" (
	"user_id" integer DEFAULT current_setting('sift.user')::integer NOT NULL,
	"rule_id" text NOT NULL,
	"account_id" text NOT NULL,
	"filter_id" text,
	"state" text,
	"written" text,
	"checked_at" bigint NOT NULL,
	CONSTRAINT "rule_filters_user_id_rule_id_account_id_pk" PRIMARY KEY("user_id","rule_id","account_id"),
	CONSTRAINT "rule_filters_state" CHECK ("rule_filters"."state" IN ('active', 'changed', 'gone', 'outdated'))
);
--> statement-breakpoint
ALTER TABLE "rule_filters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_label";
--> statement-breakpoint
ALTER TABLE "examples" DROP CONSTRAINT "examples_label";
--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_label";
--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_label";
--> statement-breakpoint
ALTER TABLE "rules" DROP CONSTRAINT "rules_label";
--> statement-breakpoint
ALTER TABLE "rules" DROP CONSTRAINT "rules_when_label";
--> statement-breakpoint
ALTER TABLE "rule_filters" ADD CONSTRAINT "rule_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_filters" ADD CONSTRAINT "rule_filters_user_id_rule_id_rules_user_id_id_fk" FOREIGN KEY ("user_id","rule_id") REFERENCES "public"."rules"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_filters" ADD CONSTRAINT "rule_filters_user_id_account_id_mailboxes_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."mailboxes"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "own" ON "rule_filters" AS PERMISSIVE FOR ALL TO "sift_app" USING (user_id = nullif(current_setting('sift.user', true), '')::integer) WITH CHECK (user_id = nullif(current_setting('sift.user', true), '')::integer);