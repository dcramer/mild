ALTER TABLE "messages" ALTER COLUMN "subject" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "to_addresses" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "to_addresses" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "cc_addresses" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "cc_addresses" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "headers" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "headers" DROP DEFAULT;