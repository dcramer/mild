-- 1 when the decision is the user's own answer from the dashboard. Such a decision is carried out in Gmail
-- even while sift only observes: the user pressed it. Anything else waits for sift to be acting.
ALTER TABLE decisions ADD COLUMN by_user INTEGER NOT NULL DEFAULT 0 CHECK (by_user IN (0, 1));
