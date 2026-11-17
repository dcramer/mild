ALTER TABLE "proposals" DROP CONSTRAINT "proposals_once";--> statement-breakpoint
ALTER TABLE "correspondents" DROP CONSTRAINT "correspondents_user_id_account_id_address_pk";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "sender_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "domain_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "conditions" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "conditions" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "correspondents" ADD CONSTRAINT "correspondents_user_id_account_id_address_hash_pk" PRIMARY KEY("user_id","account_id","address_hash");--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_once" UNIQUE("user_id","account_id","kind","conditions");