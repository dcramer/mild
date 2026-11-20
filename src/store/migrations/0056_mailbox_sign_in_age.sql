ALTER TABLE "mailboxes" ADD COLUMN "signed_in_at" bigint;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "weekly_sign_in" boolean DEFAULT false NOT NULL;