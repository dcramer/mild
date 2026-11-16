-- Extras: things a label or a rule does besides its outcome. A label may unsubscribe; a rule may add
-- either extra for the mail it matches (its `subscription` column was already there).
ALTER TABLE labels ADD COLUMN unsubscribe INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rules ADD COLUMN mark_read INTEGER NOT NULL DEFAULT 0;

-- The default labels for bulk mail unsubscribe. Nothing is sent while sift is only observing.
UPDATE labels SET unsubscribe = 1 WHERE id IN ('newsletter', 'marketing', 'cold_outreach', 'junk');
