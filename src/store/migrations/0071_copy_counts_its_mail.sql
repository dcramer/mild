ALTER TABLE "mail_copies" ADD COLUMN "count_token" text;--> statement-breakpoint
ALTER TABLE "mail_copies" ADD COLUMN "counted" boolean DEFAULT false NOT NULL;