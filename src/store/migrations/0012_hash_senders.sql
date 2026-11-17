DROP INDEX "messages_sender";--> statement-breakpoint
DROP INDEX "messages_domain";--> statement-breakpoint
ALTER TABLE "actions" ALTER COLUMN "payload" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "match" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "match" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "except_matches" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "except_matches" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "filter_written" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "correspondents" ADD COLUMN "address_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "correspondents" ADD COLUMN "domain_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_hash" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "domain_hash" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "conditions" text;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "conditions" text;--> statement-breakpoint
CREATE INDEX "correspondents_domain" ON "correspondents" USING btree ("account_id","domain_hash");--> statement-breakpoint
CREATE INDEX "messages_sender" ON "messages" USING btree ("account_id","sender_hash");--> statement-breakpoint
CREATE INDEX "messages_domain" ON "messages" USING btree ("account_id","domain_hash");--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "list_id";