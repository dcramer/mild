-- A condition now holds a list of values. Conditions are encrypted, so SQL cannot rewrite them: these
-- stand-ins send every rule and proposal through the rekey pass (`sift run` at start, Vercel in the build),
-- which reads one string as a list of it and hashes the conditions again.
UPDATE "rules" SET "conditions" = 'unset:' || md5("match" || ' ' || "except_matches");--> statement-breakpoint
UPDATE "proposals" SET "conditions" = 'unset:' || md5("match");
