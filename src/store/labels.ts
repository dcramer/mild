import { and, asc, eq, labels } from './query.ts';
import type { Sql } from './sql.ts';
import type { Disposition, Label } from '../triage/types.ts';
import { Refusal } from '../refusal.ts';

/**
 * The starting set for a new mailbox, with what most people want done with each. They are only carried
 * out once the user turns sift on; until then every one is a suggestion.
 *
 * Whether bulk mail is wanted depends on its sender, not its kind, so Newsletters and Marketing archive
 * without unsubscribing: wanted senders get a rule of their own. Cold outreach unsubscribes because its
 * one-click address belongs to the tool sending the follow-ups; a person writing by hand has none.
 * Nothing unsubscribes from scams, which only confirms the address works, and nothing blocks by default:
 * phishing domains change, mostly fail DMARC so cannot be blocked anyway, and a mistake blocks a real company.
 */
export const DEFAULT_LABELS: readonly Label[] = [
  {
    id: 'personal',
    name: 'Personal',
    description:
      'Written by a person to the owner or a small group, however short or oddly written: conversation, a direct request, an introduction, a reply in a conversation the owner took part in, a stranger writing about something particular to the owner. Not mail a company sends, however much the owner wants it.',
    disposition: 'keep',
    gmailLabel: 'sift/personal',
  },
  {
    id: 'security',
    name: 'Account alerts',
    description:
      "Something about the owner's own account that may need them: sign-in alerts, password resets, verification codes, a locked or changed account, a failed payment, a bill due, a card expiring, a renewal about to charge. However alarming, when the sender is who they claim to be. Not a change to terms or a privacy policy.",
    disposition: 'keep',
    gmailLabel: 'sift/security',
  },
  {
    id: 'transactional',
    name: 'Receipts',
    description:
      'A record of something the owner did: receipts and paid invoices, order confirmations, shipping and delivery updates, bookings, statements, tax documents. Even from a company that also sends promotions, or one they have not had mail from before. Not something they still have to pay or do.',
    disposition: 'archive',
    gmailLabel: 'sift/receipts',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description:
      "An invitation to a meeting or event from a person, or a change or cancellation to one the owner is in. Not replies to the owner's own invitations or automatic reminders, nor an event a company invites a whole list to.",
    disposition: 'keep',
    gmailLabel: 'sift/calendar',
  },
  {
    id: 'request',
    name: 'Asks for you',
    description:
      'Automated mail from a service where someone asks the owner in particular to do something: a review requested, an assignment, a mention, an approval or a question waiting on them. Not activity they are only watching.',
    disposition: 'keep',
    gmailLabel: 'sift/asks',
  },
  {
    id: 'notification',
    name: 'Notifications',
    description:
      'Automated activity from a service the owner uses that asks nothing of them: comments and changes on things they watch, builds, alerts, reports, digests, replies to their invitations, reminders, changes to terms or privacy policies.',
    disposition: 'archive',
    gmailLabel: 'sift/notifications',
  },
  {
    id: 'newsletter',
    name: 'Newsletters',
    description: 'Editorial or community content from a list the owner subscribed to: writers, publications, digests, community mailing lists.',
    disposition: 'archive',
    gmailLabel: 'sift/newsletters',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description:
      'Promotions, sales, product announcements, events and re-engagement mail a company sends to a whole list, whether the owner wants it or never asked for it. Not mail about the owner in particular: their order, account or support request.',
    disposition: 'archive',
    gmailLabel: 'sift/marketing',
  },
  {
    id: 'cold_outreach',
    name: 'Cold outreach',
    description:
      'An unsolicited pitch from a stranger, written from a template or sent as a sequence of follow-ups: sales, recruiting, partnerships, guest posts, fundraising, surveys. Not someone the owner has written to or who is answering them, nor a stranger writing about something particular to the owner.',
    disposition: 'archive',
    gmailLabel: 'sift/cold-outreach',
    unsubscribe: true,
  },
  {
    id: 'phishing',
    name: 'Scams and phishing',
    description:
      'An attempt to deceive the owner: a fake sign-in, invoice, delivery or security notice, a request for credentials, payment or gift cards, a scam or deceptive offer, or a sender pretending to be a person or company they are not. Being unexpected or from a new sender is not enough.',
    disposition: 'spam',
    gmailLabel: 'sift/phishing',
  },
];

const toRow = (accountId: string, l: Label, position: number, now: number) => ({
  accountId,
  id: l.id,
  name: l.name,
  description: l.description,
  disposition: l.disposition,
  gmailLabel: l.gmailLabel,
  position,
  updatedAt: now,
  block: l.block ?? false,
  markRead: l.markRead ?? false,
  unsubscribe: l.unsubscribe ?? false,
});

/** A new mailbox's labels, written with it (`ensureMailbox`). */
export const defaultLabelRows = (accountId: string, now: number) => DEFAULT_LABELS.map((l, index) => toRow(accountId, l, index, now));

/** An account's labels in order. */
export async function listLabels(db: Sql, accountId: string): Promise<Label[]> {
  const rows = await db
    .select({
      id: labels.id,
      name: labels.name,
      description: labels.description,
      disposition: labels.disposition,
      gmailLabel: labels.gmailLabel,
      block: labels.block,
      markRead: labels.markRead,
      unsubscribe: labels.unsubscribe,
    })
    .from(labels)
    .where(eq(labels.accountId, accountId))
    .orderBy(asc(labels.position), asc(labels.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    disposition: r.disposition,
    gmailLabel: r.gmailLabel,
    ...(r.block ? { block: true } : {}),
    ...(r.markRead ? { markRead: true } : {}),
    ...(r.unsubscribe ? { unsubscribe: true } : {}),
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
/** Labels an account may have. Each is a choice the model weighs on every message and the reader answers with, so a long list makes both worse. */
export const MAX_LABELS = 12;

export async function addLabel(
  db: Sql,
  accountId: string,
  label: { name: string; description: string; disposition: Disposition; block?: boolean; markRead?: boolean; unsubscribe?: boolean },
  now: number = Date.now(),
): Promise<Label> {
  const name = label.name.trim();
  const id = slug(name);
  if (id === '' || RESERVED.has(id)) throw new Refusal(`"${name}" cannot be used as a label name.`);
  const existing = await listLabels(db, accountId);
  if (existing.length >= MAX_LABELS) throw new Refusal(`Sift keeps at most ${MAX_LABELS} labels. Change one that is no longer used instead.`);
  if (existing.some((l) => l.id === id || l.id.replace(/_/g, '-') === id || l.gmailLabel === `sift/${id}` || l.name.toLowerCase() === name.toLowerCase()))
    throw new Refusal(`There is already a label "${name}".`);
  const extras = normalise(label.disposition, label.block ?? false, label.markRead ?? false);
  const created: Label = {
    id,
    name,
    description: label.description.trim(),
    disposition: label.disposition,
    gmailLabel: `sift/${id}`,
    ...extras,
    ...(label.unsubscribe ? { unsubscribe: true } : {}),
  };
  await db.insert(labels).values(toRow(accountId, created, existing.length, now));
  return created;
}

/**
 * Change a label's name, how it is recognised, or what happens to its mail. Rules that name the label
 * follow it, unless they carry their own action. Returns false if there is no such label.
 */
export async function updateLabel(
  db: Sql,
  accountId: string,
  id: string,
  change: { name?: string; description?: string; disposition?: Disposition; block?: boolean; markRead?: boolean; unsubscribe?: boolean },
  now: number = Date.now(),
): Promise<boolean> {
  const current = (await listLabels(db, accountId)).find((l) => l.id === id);
  if (!current) return false;
  const disposition = change.disposition ?? current.disposition;
  // Changing what a label does drops a block unless the change asks for one.
  const extras = normalise(
    disposition,
    change.block ?? (change.disposition === undefined && (current.block ?? false)),
    change.markRead ?? current.markRead ?? false,
  );
  await db
    .update(labels)
    .set({
      name: change.name?.trim() || current.name,
      description: change.description?.trim() ?? current.description,
      disposition,
      block: extras.block ?? false,
      markRead: extras.markRead ?? false,
      unsubscribe: change.unsubscribe ?? current.unsubscribe ?? false,
      updatedAt: now,
    })
    .where(and(eq(labels.accountId, accountId), eq(labels.id, id)));
  return true;
}
