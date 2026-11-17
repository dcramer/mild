ALTER TABLE "correspondents" DROP COLUMN "address";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "from_address";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "from_domain";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "from_name";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "subject";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "to_addresses";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "cc_addresses";