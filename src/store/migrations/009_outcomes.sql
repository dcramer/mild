-- What a label does is one of: keep, archive, mark spam, or block (mark spam and treat everything from
-- that sender as spam from then on). `block` and `mark_read` are extras on the disposition, so the
-- constrained columns keep their values.
ALTER TABLE labels ADD COLUMN block INTEGER NOT NULL DEFAULT 0;
ALTER TABLE labels ADD COLUMN mark_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE decisions ADD COLUMN block INTEGER NOT NULL DEFAULT 0;
ALTER TABLE decisions ADD COLUMN mark_read INTEGER NOT NULL DEFAULT 0;

-- "Leave it for me" is no longer something a label does: sift suggesting instead of acting is a
-- matter of trust, not an outcome. Labels still at that default take the new default; any other
-- label set to it is kept in the inbox.
UPDATE labels SET disposition = 'archive' WHERE id = 'cold_outreach' AND disposition = 'review';
UPDATE labels SET disposition = 'spam' WHERE id = 'junk' AND disposition = 'review';
UPDATE labels SET disposition = 'keep' WHERE disposition = 'review';

INSERT INTO labels (account_id, id, name, description, disposition, block, gmail_label, position, updated_at)
SELECT a.id, 'phishing', 'Phishing',
  'An attempt to trick the owner: a fake sign-in, invoice, delivery or security notice, a request for credentials, payment or gift cards, or a sender pretending to be a person or company they are not.',
  'spam', 1, 'sift/phishing',
  (SELECT coalesce(max(position), 0) + 1 FROM labels l WHERE l.account_id = a.id), 0
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM labels l WHERE l.account_id = a.id AND (l.id = 'phishing' OR l.gmail_label = 'sift/phishing'));
