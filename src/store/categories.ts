import type { DatabaseSync } from 'node:sqlite';
import type { Category } from '../triage/stages/model.ts';
import type { Disposition } from '../triage/types.ts';

/**
 * The starting set for a new account. Deliberately cautious: only clearly bulk mail leaves the inbox,
 * and unsolicited pitches are left for the user until they say otherwise.
 */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  {
    key: 'personal',
    name: 'Personal',
    description: 'Written by a person to the owner or a small group: conversation, a direct request, an introduction, a reply.',
    disposition: 'keep',
  },
  {
    key: 'security',
    name: 'Security and account',
    description: "Sign-in alerts, password resets, verification codes, account, legal or policy notices that concern the owner's own account.",
    disposition: 'keep',
  },
  {
    key: 'transactional',
    name: 'Receipts and transactions',
    description: 'Receipts, invoices, orders, shipping, bookings, statements, payment or renewal notices for something the owner did or owes.',
    disposition: 'keep',
    label: 'sift/receipts',
  },
  { key: 'calendar', name: 'Calendar', description: 'Meeting invitations, changes, cancellations and reminders.', disposition: 'keep' },
  {
    key: 'notification',
    name: 'Notifications',
    description: 'Automated activity from a service the owner uses: comments, mentions, builds, alerts, reports, digests of their own activity.',
    disposition: 'keep',
    label: 'sift/notifications',
  },
  {
    key: 'newsletter',
    name: 'Newsletters',
    description: 'Editorial or community content sent to a list the owner appears to have subscribed to.',
    disposition: 'archive',
    label: 'sift/newsletters',
  },
  {
    key: 'marketing',
    name: 'Marketing',
    description: 'Promotions, sales, product announcements, webinars and re-engagement mail from a company.',
    disposition: 'archive',
    label: 'sift/marketing',
  },
  {
    key: 'cold_outreach',
    name: 'Cold outreach',
    description: 'An unsolicited pitch from a stranger: sales, recruiting, partnerships, guest posts, fundraising, surveys.',
    disposition: 'review',
    label: 'sift/cold-outreach',
  },
];

interface Row {
  key: string;
  name: string;
  description: string;
  disposition: Disposition;
  label: string | null;
}

/** An account's categories in order, seeding the defaults the first time. */
export function listCategories(db: DatabaseSync, accountId: string, now: number = Date.now()): Category[] {
  const select = db.prepare('SELECT key, name, description, disposition, label FROM categories WHERE account_id = ? ORDER BY position, key');
  let rows = select.all(accountId) as unknown as Row[];
  if (rows.length === 0) {
    const insert = db.prepare(
      'INSERT INTO categories (account_id, key, name, description, disposition, label, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    DEFAULT_CATEGORIES.forEach((c, index) => insert.run(accountId, c.key, c.name, c.description, c.disposition, c.label ?? null, index, now));
    rows = select.all(accountId) as unknown as Row[];
  }
  return rows.map((r) => ({ key: r.key, name: r.name, description: r.description, disposition: r.disposition, ...(r.label ? { label: r.label } : {}) }));
}

/** Change what happens to a category. `label: null` removes the label. Returns false if there is no such category. */
export function updateCategory(
  db: DatabaseSync,
  accountId: string,
  key: string,
  change: { disposition?: Disposition; label?: string | null },
  now: number = Date.now(),
): boolean {
  if (!listCategories(db, accountId, now).some((c) => c.key === key)) return false;
  if (change.disposition)
    db.prepare('UPDATE categories SET disposition = ?, updated_at = ? WHERE account_id = ? AND key = ?').run(change.disposition, now, accountId, key);
  if (change.label !== undefined)
    db.prepare('UPDATE categories SET label = ?, updated_at = ? WHERE account_id = ? AND key = ?').run(change.label, now, accountId, key);
  // Senders learned under the old setting would keep applying it, so forget them; they are relearned.
  db.prepare(`DELETE FROM senders WHERE account_id = ? AND category = ? AND source = 'agent'`).run(accountId, key);
  return true;
}
