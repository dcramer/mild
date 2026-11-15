import type { DatabaseSync } from 'node:sqlite';
import type { Disposition, Label } from '../triage/types.ts';

/**
 * The starting set for a new account, with what most people want done with each. They are only acted
 * on once the user lets sift act; until then every one is a suggestion.
 */
export const DEFAULT_LABELS: readonly Label[] = [
  {
    id: 'personal',
    name: 'Personal',
    description: 'Written by a person to the owner or a small group: conversation, a direct request, an introduction, a reply.',
    disposition: 'keep',
    gmailLabel: 'sift/personal',
  },
  {
    id: 'security',
    name: 'Security and account',
    description: "Sign-in alerts, password resets, verification codes, account, legal or policy notices that concern the owner's own account.",
    disposition: 'keep',
    gmailLabel: 'sift/security',
  },
  {
    id: 'transactional',
    name: 'Receipts and transactions',
    description: 'Receipts, invoices, orders, shipping, bookings, statements, payment or renewal notices for something the owner did or owes.',
    disposition: 'keep',
    gmailLabel: 'sift/receipts',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Meeting invitations, changes, cancellations and reminders.',
    disposition: 'keep',
    gmailLabel: 'sift/calendar',
  },
  {
    id: 'notification',
    name: 'Notifications',
    description: 'Automated activity from a service the owner uses: comments, mentions, builds, alerts, reports, digests of their own activity.',
    disposition: 'keep',
    gmailLabel: 'sift/notifications',
  },
  {
    id: 'newsletter',
    name: 'Newsletters',
    description: 'Editorial or community content sent to a list the owner appears to have subscribed to.',
    disposition: 'archive',
    gmailLabel: 'sift/newsletters',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Promotions, sales, product announcements, webinars and re-engagement mail from a company.',
    disposition: 'archive',
    gmailLabel: 'sift/marketing',
  },
  {
    id: 'cold_outreach',
    name: 'Cold outreach',
    description: 'An unsolicited pitch from a stranger: sales, recruiting, partnerships, guest posts, fundraising, surveys.',
    disposition: 'archive',
    gmailLabel: 'sift/cold-outreach',
  },
  {
    id: 'junk',
    name: 'Junk',
    description:
      'Mail the owner never asked for and would not want: scams, phishing, deceptive offers, bulk mail from a sender with no relationship to the owner.',
    disposition: 'spam',
    gmailLabel: 'sift/junk',
  },
  {
    id: 'phishing',
    name: 'Phishing',
    description:
      'An attempt to trick the owner: a fake sign-in, invoice, delivery or security notice, a request for credentials, payment or gift cards, or a sender pretending to be a person or company they are not.',
    disposition: 'spam',
    gmailLabel: 'sift/phishing',
    block: true,
  },
];

interface Row {
  id: string;
  name: string;
  description: string;
  disposition: Disposition;
  gmail_label: string;
  block: number;
  mark_read: number;
}

const INSERT =
  'INSERT INTO labels (account_id, id, name, description, disposition, gmail_label, position, updated_at, block, mark_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/** An account's labels in order, seeding the defaults the first time. */
export function listLabels(db: DatabaseSync, accountId: string, now: number = Date.now()): Label[] {
  const select = db.prepare('SELECT id, name, description, disposition, gmail_label, block, mark_read FROM labels WHERE account_id = ? ORDER BY position, id');
  let rows = select.all(accountId) as unknown as Row[];
  if (rows.length === 0) {
    const insert = db.prepare(INSERT);
    DEFAULT_LABELS.forEach((l, index) =>
      insert.run(accountId, l.id, l.name, l.description, l.disposition, l.gmailLabel, index, now, l.block ? 1 : 0, l.markRead ? 1 : 0),
    );
    rows = select.all(accountId) as unknown as Row[];
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    disposition: r.disposition,
    gmailLabel: r.gmail_label,
    ...(r.block === 1 ? { block: true } : {}),
    ...(r.mark_read === 1 ? { markRead: true } : {}),
  }));
}

/** Names in Gmail that sift uses for something other than a label of the user's. */
const RESERVED = new Set(['review', 'did']);

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** The extras that make sense with a disposition: blocking goes with spam, marking read with keep and archive. */
function normalise(disposition: Disposition, block: boolean, markRead: boolean): { block?: true; markRead?: true } {
  return {
    ...(block && disposition === 'spam' ? { block: true as const } : {}),
    ...(markRead && (disposition === 'keep' || disposition === 'archive') ? { markRead: true as const } : {}),
  };
}

/**
 * Add a label of the user's own. Its id and its Gmail label come from the name and never change after.
 * Throws if the name is unusable or already taken.
 */
export function addLabel(
  db: DatabaseSync,
  accountId: string,
  label: { name: string; description: string; disposition: Disposition; block?: boolean; markRead?: boolean },
  now: number = Date.now(),
): Label {
  const name = label.name.trim();
  const id = slug(name);
  if (id === '' || RESERVED.has(id)) throw new Error(`"${name}" cannot be used as a label name.`);
  const existing = listLabels(db, accountId, now);
  if (existing.some((l) => l.id === id || l.id.replace(/_/g, '-') === id || l.gmailLabel === `sift/${id}` || l.name.toLowerCase() === name.toLowerCase()))
    throw new Error(`There is already a label "${name}".`);
  const extras = normalise(label.disposition, label.block ?? false, label.markRead ?? false);
  const created: Label = { id, name, description: label.description.trim(), disposition: label.disposition, gmailLabel: `sift/${id}`, ...extras };
  db.prepare(INSERT).run(
    accountId,
    created.id,
    created.name,
    created.description,
    created.disposition,
    created.gmailLabel,
    existing.length,
    now,
    created.block ? 1 : 0,
    created.markRead ? 1 : 0,
  );
  return created;
}

/**
 * Change a label's name, how it is recognised, or what happens to its mail. Rules that name the label
 * follow it, unless they carry their own action. Returns false if there is no such label.
 */
export function updateLabel(
  db: DatabaseSync,
  accountId: string,
  id: string,
  change: { name?: string; description?: string; disposition?: Disposition; block?: boolean; markRead?: boolean },
  now: number = Date.now(),
): boolean {
  const current = listLabels(db, accountId, now).find((l) => l.id === id);
  if (!current) return false;
  const disposition = change.disposition ?? current.disposition;
  // Changing what a label does drops a block unless the change asks for one.
  const extras = normalise(
    disposition,
    change.block ?? (change.disposition === undefined && (current.block ?? false)),
    change.markRead ?? current.markRead ?? false,
  );
  db.prepare('UPDATE labels SET name = ?, description = ?, disposition = ?, block = ?, mark_read = ?, updated_at = ? WHERE account_id = ? AND id = ?').run(
    change.name?.trim() || current.name,
    change.description?.trim() ?? current.description,
    disposition,
    extras.block ? 1 : 0,
    extras.markRead ? 1 : 0,
    now,
    accountId,
    id,
  );
  return true;
}
