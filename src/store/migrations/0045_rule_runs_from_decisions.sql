-- Calls made before runs said which rule they checked: those whose condition was met reached the rule's decision. Calls that found it unmet are not known.
UPDATE "model_runs" SET "rule_id" = d."rule_id"
FROM "decisions" d JOIN "rules" r ON r."user_id" = d."user_id" AND r."account_id" = d."account_id" AND r."id" = d."rule_id"
WHERE d."user_id" = "model_runs"."user_id" AND d."run_id" = "model_runs"."id" AND r."condition" IS NOT NULL;
