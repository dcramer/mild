-- Labels and rules become the person's, for every mailbox of theirs; 0049 drops their account_id. Where mailboxes
-- disagree, the primary mailbox wins, then the earliest connected.
ALTER TABLE "rule_filters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TEMP TABLE "mailbox_order" AS
SELECT "user_id", "id" AS "account_id", row_number() OVER (PARTITION BY "user_id" ORDER BY "primary" DESC, "created_at", "id") AS "n" FROM "accounts";--> statement-breakpoint

-- A rule's Gmail filter stays in the mailbox it was written to.
INSERT INTO "rule_filters" ("user_id", "rule_id", "account_id", "filter_id", "state", "written", "checked_at")
SELECT "user_id", "id", "account_id", "filter_id", "filter_state", "filter_written", coalesce("filter_checked_at", "created_at")
FROM "rules" WHERE "filter_id" IS NOT NULL OR "filter_state" IS NOT NULL;--> statement-breakpoint

-- One row per label id: one still in use over one removed.
CREATE TEMP TABLE "label_kept" AS
SELECT DISTINCT ON (l."user_id", l."id") l."user_id", l."account_id", l."id", lower(l."name") AS "name", l."removed_at" IS NULL AS "active", m."n", l."position"
FROM "labels" l JOIN "mailbox_order" m ON m."user_id" = l."user_id" AND m."account_id" = l."account_id"
ORDER BY l."user_id", l."id", l."removed_at" IS NULL DESC, m."n", l."position";--> statement-breakpoint
-- Two labels in use with one name (one renamed to the other's) are one label.
CREATE TEMP TABLE "label_moves" AS
SELECT k."user_id", k."id" AS "from_id", w."id" AS "to_id"
FROM "label_kept" k
JOIN (SELECT DISTINCT ON ("user_id", "name") "user_id", "name", "id" FROM "label_kept" WHERE "active" ORDER BY "user_id", "name", "n", "position") w
  ON w."user_id" = k."user_id" AND w."name" = k."name"
WHERE k."active" AND k."id" <> w."id";--> statement-breakpoint
UPDATE "decisions" t SET "label_id" = mv."to_id" FROM "label_moves" mv WHERE t."user_id" = mv."user_id" AND t."label_id" = mv."from_id";--> statement-breakpoint
UPDATE "feedback" t SET "label_id" = mv."to_id" FROM "label_moves" mv WHERE t."user_id" = mv."user_id" AND t."label_id" = mv."from_id";--> statement-breakpoint
UPDATE "examples" t SET "label_id" = mv."to_id" FROM "label_moves" mv WHERE t."user_id" = mv."user_id" AND t."label_id" = mv."from_id";--> statement-breakpoint
UPDATE "proposals" t SET "label_id" = mv."to_id" FROM "label_moves" mv WHERE t."user_id" = mv."user_id" AND t."label_id" = mv."from_id";--> statement-breakpoint
UPDATE "rules" t SET "label_id" = mv."to_id" FROM "label_moves" mv WHERE t."user_id" = mv."user_id" AND t."label_id" = mv."from_id";--> statement-breakpoint
UPDATE "rules" t SET "when_label" = mv."to_id" FROM "label_moves" mv WHERE t."user_id" = mv."user_id" AND t."when_label" = mv."from_id";--> statement-breakpoint
UPDATE "eval_results" t SET "expected" = mv."to_id" FROM "label_moves" mv WHERE t."user_id" = mv."user_id" AND t."expected" = mv."from_id";--> statement-breakpoint
UPDATE "eval_results" t SET "got" = mv."to_id" FROM "label_moves" mv WHERE t."user_id" = mv."user_id" AND t."got" = mv."from_id";--> statement-breakpoint
DELETE FROM "labels" l
WHERE NOT EXISTS (SELECT 1 FROM "label_kept" k WHERE k."user_id" = l."user_id" AND k."account_id" = l."account_id" AND k."id" = l."id")
  OR EXISTS (SELECT 1 FROM "label_moves" mv WHERE mv."user_id" = l."user_id" AND mv."from_id" = l."id");--> statement-breakpoint
UPDATE "labels" l SET "position" = o."position"
FROM (
  SELECT k."user_id", k."id", row_number() OVER (PARTITION BY k."user_id" ORDER BY k."n", k."position", k."id") - 1 AS "position"
  FROM "label_kept" k WHERE k."id" <> 'everything_else'
) o
WHERE o."user_id" = l."user_id" AND o."id" = l."id";--> statement-breakpoint
-- Leave in inbox is listed after every label of theirs.
UPDATE "labels" l SET "position" = greatest(30, (SELECT count(*) FROM "labels" o WHERE o."user_id" = l."user_id" AND o."id" <> 'everything_else'))
WHERE l."id" = 'everything_else';--> statement-breakpoint

-- Rules that say exactly the same are one rule. What it decided, and the model calls it made, stay its own.
CREATE TEMP TABLE "rule_moves" AS
SELECT r."user_id", r."id" AS "from_id", first_value(r."id") OVER w AS "to_id", r."hits"
FROM "rules" r JOIN "mailbox_order" m ON m."user_id" = r."user_id" AND m."account_id" = r."account_id"
WINDOW w AS (
  PARTITION BY r."user_id", r."conditions", r."label_id", r."when_label", r."disposition", r."subscription", r."mark_read", r."condition", r."source"
  ORDER BY m."n", r."position", r."id"
);--> statement-breakpoint
DELETE FROM "rule_moves" WHERE "from_id" = "to_id";--> statement-breakpoint
UPDATE "rules" r SET "hits" = r."hits" + s."hits"
FROM (SELECT "user_id", "to_id", sum("hits") AS "hits" FROM "rule_moves" GROUP BY "user_id", "to_id") s
WHERE r."user_id" = s."user_id" AND r."id" = s."to_id";--> statement-breakpoint
UPDATE "decisions" t SET "rule_id" = mv."to_id" FROM "rule_moves" mv WHERE t."user_id" = mv."user_id" AND t."rule_id" = mv."from_id";--> statement-breakpoint
UPDATE "model_runs" t SET "rule_id" = mv."to_id" FROM "rule_moves" mv WHERE t."user_id" = mv."user_id" AND t."rule_id" = mv."from_id";--> statement-breakpoint
UPDATE "inbox_runs" t SET "rule_id" = mv."to_id" FROM "rule_moves" mv WHERE t."user_id" = mv."user_id" AND t."rule_id" = mv."from_id";--> statement-breakpoint
-- Its Gmail filter in the other mailbox is no longer kept track of; writing the rule's filter there takes it over.
DELETE FROM "rules" r USING "rule_moves" mv WHERE r."user_id" = mv."user_id" AND r."id" = mv."from_id";--> statement-breakpoint
UPDATE "rules" r SET "position" = o."position"
FROM (
  SELECT r."user_id", r."id", row_number() OVER (PARTITION BY r."user_id" ORDER BY m."n", r."position", r."id") AS "position"
  FROM "rules" r JOIN "mailbox_order" m ON m."user_id" = r."user_id" AND m."account_id" = r."account_id"
) o
WHERE o."user_id" = r."user_id" AND o."id" = r."id";--> statement-breakpoint
DROP TABLE "mailbox_order", "label_kept", "label_moves", "rule_moves";
