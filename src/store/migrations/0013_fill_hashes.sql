-- Without a key a keyed hash is the value itself. With one, `sift run` hashes every message again at start, since its address is not yet encrypted.
UPDATE "messages" SET "sender_hash" = "from_address", "domain_hash" = "from_domain";--> statement-breakpoint
-- Stand-ins, unique as the conditions were: `sift run` hashes each one at start (rekeyContent), key or not.
UPDATE "rules" SET "conditions" = 'unset:' || md5("match" || ' ' || "except_matches");--> statement-breakpoint
UPDATE "proposals" SET "conditions" = 'unset:' || md5("match");
