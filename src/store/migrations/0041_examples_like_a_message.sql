ALTER TABLE "examples" ADD COLUMN "name_hash" text DEFAULT 'unset:';--> statement-breakpoint
ALTER TABLE "examples" ADD COLUMN "subject_hash" text DEFAULT 'unset:';--> statement-breakpoint
CREATE INDEX "examples_by_name" ON "examples" USING btree ("account_id","name_hash","marked_at") WHERE "examples"."status" = 'captured';--> statement-breakpoint
CREATE INDEX "examples_by_subject" ON "examples" USING btree ("account_id","subject_hash","marked_at") WHERE "examples"."status" = 'captured';--> statement-breakpoint
CREATE INDEX "examples_by_label" ON "examples" USING btree ("account_id","label_id","marked_at") WHERE "examples"."status" = 'captured';