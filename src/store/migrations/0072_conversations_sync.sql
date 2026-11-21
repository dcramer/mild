CREATE TABLE "conversation_changes" (
	"user_id" integer DEFAULT current_setting('sift.user')::integer NOT NULL,
	"account_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"changed_at" bigint NOT NULL,
	CONSTRAINT "conversation_changes_user_id_account_id_thread_id_pk" PRIMARY KEY("user_id","account_id","thread_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_heads" (
	"user_id" integer PRIMARY KEY DEFAULT current_setting('sift.user')::integer NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"purged_through" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_heads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credentials" DROP CONSTRAINT "credentials_kind";--> statement-breakpoint
ALTER TABLE "mail_bodies" ADD COLUMN "preview" text;--> statement-breakpoint
ALTER TABLE "conversation_changes" ADD CONSTRAINT "conversation_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_changes" ADD CONSTRAINT "conversation_changes_user_id_account_id_mailboxes_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."mailboxes"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_heads" ADD CONSTRAINT "sync_heads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_changes_seq" ON "conversation_changes" USING btree ("user_id","seq");--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_kind" CHECK ("credentials"."kind" IN ('gmail', 'model', 'device'));--> statement-breakpoint
CREATE POLICY "own" ON "conversation_changes" AS PERMISSIVE FOR ALL TO "sift_app" USING (user_id = nullif(current_setting('sift.user', true), '')::integer) WITH CHECK (user_id = nullif(current_setting('sift.user', true), '')::integer);--> statement-breakpoint
CREATE POLICY "own" ON "sync_heads" AS PERMISSIVE FOR ALL TO "sift_app" USING (user_id = nullif(current_setting('sift.user', true), '')::integer) WITH CHECK (user_id = nullif(current_setting('sift.user', true), '')::integer);