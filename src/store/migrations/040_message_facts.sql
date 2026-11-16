-- The structured facts about a message (`Facts` in src/triage/facts.ts), as JSON. NULL on rows synced
-- before this; readers derive them from the stored headers then.
ALTER TABLE messages ADD COLUMN facts_json TEXT;
