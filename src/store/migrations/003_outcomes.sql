-- What became of each decision, so nothing is decided and then silently dropped.
--   mode     'observe': recorded only, the mailbox was not touched. 'act': meant to be carried out.
--   outcome  NULL while an 'act' decision is still waiting to be carried out (it is retried);
--            'observed' | 'none' (nothing needed doing) | 'done' | 'skipped' | 'failed' | 'unknown'.
ALTER TABLE decisions ADD COLUMN mode TEXT NOT NULL DEFAULT 'observe' CHECK (mode IN ('act', 'observe'));
ALTER TABLE decisions ADD COLUMN outcome TEXT CHECK (outcome IN ('observed', 'none', 'done', 'skipped', 'failed', 'unknown'));
ALTER TABLE decisions ADD COLUMN outcome_detail TEXT;
UPDATE decisions SET outcome = 'observed' WHERE outcome IS NULL;
CREATE INDEX decisions_unsettled ON decisions (account_id) WHERE outcome IS NULL;
