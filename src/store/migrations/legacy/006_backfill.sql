-- Mail pulled in from before sift was connected, to give the user something to teach with. It is only
-- ever suggested about, never acted on, even when sift is acting on new mail.
ALTER TABLE messages ADD COLUMN observe_only INTEGER NOT NULL DEFAULT 0;
