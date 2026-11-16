-- Where the answer was given: `dashboard`, or `gmail` when it was read from what the user did to the message there.
ALTER TABLE feedback ADD COLUMN via TEXT NOT NULL DEFAULT 'dashboard' CHECK (via IN ('dashboard', 'gmail'));
