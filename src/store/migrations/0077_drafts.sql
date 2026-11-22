CREATE TABLE "drafts" (
	"user_id" integer DEFAULT current_setting('sift.user')::integer NOT NULL,
	"id" text NOT NULL,
	"account_id" text NOT NULL,
	"writing" text NOT NULL,
	"uploads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changed_at" bigint NOT NULL,
	"gmail_id" text,
	"pushed_at" bigint,
	"send_at" bigint,
	"send_error" text,
	CONSTRAINT "drafts_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_type";--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_account_id_mailboxes_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."mailboxes"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_changed" ON "drafts" USING btree ("user_id","changed_at");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_type" CHECK ("actions"."type" IN ('archive', 'spam', 'label', 'undo', 'unsubscribe', 'filter', 'unfilter', 'digest', 'send', 'read', 'unread', 'draft'));--> statement-breakpoint
CREATE POLICY "own" ON "drafts" AS PERMISSIVE FOR ALL TO "sift_app" USING (user_id = nullif(current_setting('sift.user', true), '')::integer) WITH CHECK (user_id = nullif(current_setting('sift.user', true), '')::integer);