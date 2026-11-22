CREATE TABLE "addresses" (
	"user_id" integer DEFAULT current_setting('sift.user')::integer NOT NULL,
	"account_id" text NOT NULL,
	"address_hash" text NOT NULL,
	"who" text NOT NULL,
	"named" boolean NOT NULL,
	"search" "bytea" NOT NULL,
	"seen_at" bigint NOT NULL,
	"wrote_at" bigint,
	"heard_at" bigint,
	CONSTRAINT "addresses_user_id_account_id_address_hash_pk" PRIMARY KEY("user_id","account_id","address_hash")
);
--> statement-breakpoint
ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "upload_pieces" (
	"user_id" integer DEFAULT current_setting('sift.user')::integer NOT NULL,
	"upload_id" text NOT NULL,
	"piece" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "upload_pieces_user_id_upload_id_piece_pk" PRIMARY KEY("user_id","upload_id","piece")
);
--> statement-breakpoint
ALTER TABLE "upload_pieces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "uploads" (
	"user_id" integer DEFAULT current_setting('sift.user')::integer NOT NULL,
	"id" text NOT NULL,
	"about" text NOT NULL,
	"size" integer NOT NULL,
	"pieces" integer NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "uploads_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mail_bodies" ADD COLUMN "attachments" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "addresses_from" text;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_account_id_mailboxes_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."mailboxes"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_pieces" ADD CONSTRAINT "upload_pieces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_pieces" ADD CONSTRAINT "upload_pieces_user_id_upload_id_uploads_user_id_id_fk" FOREIGN KEY ("user_id","upload_id") REFERENCES "public"."uploads"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_created" ON "uploads" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "own" ON "addresses" AS PERMISSIVE FOR ALL TO "sift_app" USING (user_id = nullif(current_setting('sift.user', true), '')::integer) WITH CHECK (user_id = nullif(current_setting('sift.user', true), '')::integer);--> statement-breakpoint
CREATE POLICY "own" ON "upload_pieces" AS PERMISSIVE FOR ALL TO "sift_app" USING (user_id = nullif(current_setting('sift.user', true), '')::integer) WITH CHECK (user_id = nullif(current_setting('sift.user', true), '')::integer);--> statement-breakpoint
CREATE POLICY "own" ON "uploads" AS PERMISSIVE FOR ALL TO "sift_app" USING (user_id = nullif(current_setting('sift.user', true), '')::integer) WITH CHECK (user_id = nullif(current_setting('sift.user', true), '')::integer);