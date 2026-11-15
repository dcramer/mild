-- Labels: what mail is. One vocabulary for every tier, replacing categories. Each has a Gmail label
-- and the action sift takes on mail that carries it.
CREATE TABLE labels (
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  id           TEXT NOT NULL,      -- stable; the name can change without orphaning history
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,      -- how to recognise it; shown to the model
  disposition  TEXT NOT NULL CHECK (disposition IN ('keep', 'archive', 'spam', 'review')),
  gmail_label  TEXT NOT NULL,
  position     INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
) STRICT;

INSERT INTO labels (account_id, id, name, description, disposition, gmail_label, position, updated_at)
SELECT account_id, key, name, description, disposition, coalesce(label, 'sift/' || replace(key, '_', '-')), position, updated_at FROM categories;
DROP TABLE categories;

-- Accounts whose labels were never seeded get the defaults now, so their rules and senders have something to point at.
WITH d(id, name, description, disposition, gmail_label, position) AS (
  VALUES
    ('personal', 'Personal', 'Written by a person to the owner or a small group: conversation, a direct request, an introduction, a reply.', 'keep', 'sift/personal', 0),
    ('security', 'Security and account', 'Sign-in alerts, password resets, verification codes, account, legal or policy notices that concern the owner''s own account.', 'keep', 'sift/security', 1),
    ('transactional', 'Receipts and transactions', 'Receipts, invoices, orders, shipping, bookings, statements, payment or renewal notices for something the owner did or owes.', 'keep', 'sift/receipts', 2),
    ('calendar', 'Calendar', 'Meeting invitations, changes, cancellations and reminders.', 'keep', 'sift/calendar', 3),
    ('notification', 'Notifications', 'Automated activity from a service the owner uses: comments, mentions, builds, alerts, reports, digests of their own activity.', 'keep', 'sift/notifications', 4),
    ('newsletter', 'Newsletters', 'Editorial or community content sent to a list the owner appears to have subscribed to.', 'archive', 'sift/newsletters', 5),
    ('marketing', 'Marketing', 'Promotions, sales, product announcements, webinars and re-engagement mail from a company.', 'archive', 'sift/marketing', 6),
    ('cold_outreach', 'Cold outreach', 'An unsolicited pitch from a stranger: sales, recruiting, partnerships, guest posts, fundraising, surveys.', 'review', 'sift/cold-outreach', 7)
)
INSERT INTO labels (account_id, id, name, description, disposition, gmail_label, position, updated_at)
SELECT a.id, d.id, d.name, d.description, d.disposition, d.gmail_label, d.position, 0
FROM accounts a, d
WHERE NOT EXISTS (SELECT 1 FROM labels l WHERE l.account_id = a.id);

-- New with labels: somewhere for unwanted mail to go. It only asks until the user says to mark it spam.
INSERT INTO labels (account_id, id, name, description, disposition, gmail_label, position, updated_at)
SELECT a.id, 'junk', 'Junk', 'Mail the owner never asked for and would not want: scams, phishing, deceptive offers, bulk mail from a sender with no relationship to the owner.', 'review', 'sift/junk',
  (SELECT coalesce(max(position), 0) + 1 FROM labels l WHERE l.account_id = a.id), 0
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM labels l WHERE l.account_id = a.id AND (l.id = 'junk' OR l.gmail_label = 'sift/junk'));

-- A rule now says which label mail is. `disposition` becomes an optional exception to that label's action.
CREATE TABLE rules_new (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  position      INTEGER NOT NULL,
  match_json    TEXT NOT NULL,
  except_json   TEXT NOT NULL DEFAULT '[]',
  label_id      TEXT NOT NULL,
  disposition   TEXT CHECK (disposition IN ('keep', 'archive', 'spam')),   -- NULL: do what the label does
  subscription  TEXT NOT NULL DEFAULT 'preserve' CHECK (subscription IN ('preserve', 'unsubscribe')),
  source        TEXT NOT NULL CHECK (source IN ('user', 'agent', 'correction')),
  hits          INTEGER NOT NULL DEFAULT 0,
  filter_id     TEXT,            -- set once promoted to a Gmail filter
  created_at    INTEGER NOT NULL
) STRICT;

-- Old rules named no label: use the one with the same Gmail label, else one that does the same thing (Junk for spam).
INSERT INTO rules_new (id, account_id, position, match_json, except_json, label_id, disposition, subscription, source, hits, filter_id, created_at)
SELECT r.id, r.account_id, r.position, r.match_json, r.except_json,
  coalesce(
    (SELECT l.id FROM labels l WHERE l.account_id = r.account_id AND l.gmail_label = r.label ORDER BY l.position LIMIT 1),
    (SELECT l.id FROM labels l WHERE l.account_id = r.account_id AND l.disposition = r.disposition ORDER BY l.position LIMIT 1),
    (SELECT l.id FROM labels l WHERE l.account_id = r.account_id AND l.id = 'junk' AND r.disposition = 'spam'),
    (SELECT l.id FROM labels l WHERE l.account_id = r.account_id ORDER BY l.position LIMIT 1)),
  r.disposition, r.subscription, r.source, r.hits, r.filter_id, r.created_at
FROM rules r;

-- A remembered sender is a rule with one condition.
INSERT INTO rules_new (id, account_id, position, match_json, label_id, disposition, source, created_at)
SELECT 'r-' || lower(hex(randomblob(4))), s.account_id,
  (SELECT coalesce(max(position), 0) FROM rules_new n WHERE n.account_id = s.account_id) + row_number() OVER (PARTITION BY s.account_id ORDER BY s.updated_at, s.address),
  json_object('from', s.address),
  coalesce(
    (SELECT l.id FROM labels l WHERE l.account_id = s.account_id AND l.id = s.category),
    (SELECT l.id FROM labels l WHERE l.account_id = s.account_id AND l.gmail_label = s.label ORDER BY l.position LIMIT 1),
    (SELECT l.id FROM labels l WHERE l.account_id = s.account_id AND l.disposition = s.disposition ORDER BY l.position LIMIT 1),
    (SELECT l.id FROM labels l WHERE l.account_id = s.account_id AND l.id = 'junk' AND s.disposition = 'spam'),
    (SELECT l.id FROM labels l WHERE l.account_id = s.account_id ORDER BY l.position LIMIT 1)),
  s.disposition, s.source, s.updated_at
FROM senders s;

UPDATE rules_new SET disposition = NULL
WHERE disposition = (SELECT l.disposition FROM labels l WHERE l.account_id = rules_new.account_id AND l.id = rules_new.label_id);

DROP TABLE senders;
DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;
CREATE INDEX rules_account ON rules (account_id, position);

ALTER TABLE decisions RENAME COLUMN category TO label_id;
ALTER TABLE decisions RENAME COLUMN label TO gmail_label;
ALTER TABLE feedback RENAME COLUMN category TO label_id;
ALTER TABLE examples RENAME COLUMN category TO label_id;
