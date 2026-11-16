-- When sift saw that the user had opened the message: UNREAD taken off in Gmail by a hand other than sift's.
-- Gmail's history carries no times, so this is when the sync that noticed ran. NULL: not known to have been opened.
ALTER TABLE messages ADD COLUMN read_at INTEGER;
