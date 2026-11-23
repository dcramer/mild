ALTER TABLE "actions" ADD COLUMN "alongside" integer;--> statement-breakpoint
CREATE INDEX "actions_alongside" ON "actions" USING btree ("alongside") WHERE "actions"."alongside" IS NOT NULL;