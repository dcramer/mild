-- A rule the user asked to have in Gmail too. `filter_id` is the filter while it exists there.
-- `active`: as sift wrote it. `changed`: edited in Gmail. `gone`: deleted in Gmail.
-- `outdated`: the rule no longer says what the filter does.
ALTER TABLE rules ADD COLUMN filter_state TEXT CHECK (filter_state IN ('active', 'changed', 'gone', 'outdated'));
-- What the rule asked for and what Gmail stored, to tell a later edit on either side.
ALTER TABLE rules ADD COLUMN filter_json TEXT;
ALTER TABLE rules ADD COLUMN filter_checked_at INTEGER;

ALTER TABLE accounts ADD COLUMN filters_checked_at INTEGER;
