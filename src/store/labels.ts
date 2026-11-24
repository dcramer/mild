import { and, asc, desc, eq, examples, inArray, isNotNull, isNull, labelProposals, labels, or, rules, sql } from './query.ts';
import { costOf } from './runs.ts';
import { labelProposalName, openJson, sealJson } from './content.ts';
import type { LabelDraft } from '../triage/proposal.ts';
import type { Usage } from '../triage/stages/model.ts';
import type { Sql } from './sql.ts';
import { type Disposition, LEAVE_IN_INBOX, LEAVE_IN_INBOX_NAME, type Label } from '../triage/types.ts';
import { Refusal } from '../refusal.ts';
import type { Confidential, Sealed } from '../confidential.ts';

/**
 * The only choice a new person has; the labels are their own, from what they want of Mild. Listed after
 * every label of theirs. Nothing about it changes: mail to treat differently gets a label of the person's own.
 */
const leaveInInbox: Label = { id: LEAVE_IN_INBOX, name: LEAVE_IN_INBOX_NAME, description: '', disposition: 'keep' };

const toRow = (l: Label, position: number) => ({
  id: l.id,
  name: l.name,
  description: l.description,
  disposition: l.disposition,
  gmailLabel: l.gmailLabel ?? null,
  position,
  block: l.block ?? false,
  digest: l.digest ?? false,
  markRead: l.markRead ?? false,
  unsubscribe: l.unsubscribe ?? false,
});

/** A person's one label before they have any of their own, written with their first mailbox (`ensureMailbox`). */
export const inboxRow = () => toRow(leaveInInbox, MAX_LABELS);

/** The person's labels in order, leaving out removed ones. */
export async function listLabels(db: Sql): Promise<Label[]> {
  const rows = await db
    .select({
      id: labels.id,
      name: labels.name,
      description: labels.description,
      disposition: labels.disposition,
      gmailLabel: labels.gmailLabel,
      block: labels.block,
      digest: labels.digest,
      markRead: labels.markRead,
      unsubscribe: labels.unsubscribe,
    })
    .from(labels)
    .where(isNull(labels.removedAt))
    .orderBy(asc(labels.position), asc(labels.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    disposition: r.disposition,
    ...(r.gmailLabel === null ? {} : { gmailLabel: r.gmailLabel }),
    ...(r.block ? { block: true } : {}),
    ...(r.digest ? { digest: true } : {}),
    ...(r.markRead ? { markRead: true } : {}),
    ...(r.unsubscribe ? { unsubscribe: true } : {}),
  }));
}

/** What each of the person's labels is called, removed ones too, for naming what mail was. */
export async function labelNames(db: Sql): Promise<Map<string, string>> {
  const rows = await db.select({ id: labels.id, name: labels.name }).from(labels);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Names in Gmail that Mild uses for something other than a label of the user's. */
const RESERVED = new Set(['review', 'did', 'digest']);

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** The extras that make sense with a disposition: blocking goes with spam, a digest with archive, marking read with keep and archive. */
function normalise(disposition: Disposition, block: boolean, digest: boolean, markRead: boolean): { block?: true; digest?: true; markRead?: true } {
  return {
    ...(block && disposition === 'spam' ? { block: true as const } : {}),
    ...(digest && disposition === 'archive' ? { digest: true as const } : {}),
    ...(markRead && (disposition === 'keep' || disposition === 'archive') ? { markRead: true as const } : {}),
  };
}

/** Labels a person may have of their own, besides Leave in inbox. Each is a choice the model weighs on every message and the reader answers with, so a long list makes both worse. */
export const MAX_LABELS = 30;

type NewLabel = { name: string; description: string; disposition: Disposition; block?: boolean; digest?: boolean; markRead?: boolean; unsubscribe?: boolean };

/** `label` as it would be added beside `existing`. Its id and Gmail label come from the name and never change after. */
function draft(existing: readonly Label[], label: NewLabel): Label {
  const name = label.name.trim();
  const id = slug(name);
  if (id === '' || RESERVED.has(id)) throw new Refusal(`"${name}" cannot be used as a label name.`);
  if (existing.filter((l) => l.id !== LEAVE_IN_INBOX).length >= MAX_LABELS)
    throw new Refusal(`Mild keeps at most ${MAX_LABELS} labels. Remove one you no longer use first.`);
  if (
    existing.some(
      (l) =>
        l.id === id ||
        (l.id !== LEAVE_IN_INBOX && l.id.replace(/_/g, '-') === id) ||
        l.gmailLabel === `mild/${id}` ||
        l.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Refusal(`There is already a label "${name}".`);
  return {
    id,
    name,
    description: label.description.trim(),
    disposition: label.disposition,
    gmailLabel: `mild/${id}`,
    ...normalise(label.disposition, label.block ?? false, label.digest ?? false, label.markRead ?? false),
    ...(label.unsubscribe ? { unsubscribe: true } : {}),
  };
}

/** Add labels of the user's own, all or none. Throws if a name is unusable or already taken. A removed label's name brings it back, as this. */
export async function addLabels(db: Sql, added: readonly NewLabel[]): Promise<Label[]> {
  const existing = await listLabels(db);
  const created: Label[] = [];
  for (const label of added) created.push(draft([...existing, ...created], label));
  if (created.length > 0)
    await db
      .insert(labels)
      .values(created.map((l, index) => toRow(l, existing.length + index)))
      .onConflictDoUpdate({
        target: [labels.userId, labels.id],
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          disposition: sql`excluded.disposition`,
          block: sql`excluded.block`,
          digest: sql`excluded.digest`,
          markRead: sql`excluded.mark_read`,
          unsubscribe: sql`excluded.unsubscribe`,
          position: sql`excluded.position`,
          removedAt: null,
        },
      });
  return created;
}

/**
 * Remove a label: nothing is offered it again, and rules that name it and examples of it go. What mail was
 * said to be stays named. Gmail filters of those rules are the caller's to take out first. False if there
 * is no such label.
 */
export async function removeLabel(db: Sql, id: string, now: number): Promise<boolean> {
  const removed = await db
    .update(labels)
    .set({ removedAt: now })
    .where(and(eq(labels.id, id), isNull(labels.removedAt)))
    .returning({ id: labels.id });
  if (removed.length === 0) return false;
  await db.delete(rules).where(or(eq(rules.labelId, id), eq(rules.whenLabel, id)));
  await db.delete(examples).where(eq(examples.labelId, id));
  return true;
}

/** Whether the person has a label of their own, besides Leave in inbox. Until they do, Mild reads nothing from their Gmail. */
export async function hasOwnLabels(db: Sql): Promise<boolean> {
  return (await listLabels(db)).some((l) => l.id !== LEAVE_IN_INBOX);
}

/**
 * Change a label's name, how it is recognised, or what happens to its mail. Rules that name the label
 * follow it, unless they carry their own action. Returns false if there is no such label.
 */
export async function updateLabel(
  db: Sql,
  id: string,
  change: { name?: string; description?: string; disposition?: Disposition; block?: boolean; digest?: boolean; markRead?: boolean; unsubscribe?: boolean },
): Promise<boolean> {
  const current = (await listLabels(db)).find((l) => l.id === id);
  if (!current) return false;
  if (id === LEAVE_IN_INBOX)
    throw new Refusal('Leave in inbox is Mild’s own and does not change. Add a label of your own for mail you want treated differently.');
  const disposition = change.disposition ?? current.disposition;
  // Changing what a label does drops a block or a digest unless the change asks for one.
  const extras = normalise(
    disposition,
    change.block ?? (change.disposition === undefined && (current.block ?? false)),
    change.digest ?? (change.disposition === undefined && (current.digest ?? false)),
    change.markRead ?? current.markRead ?? false,
  );
  await db
    .update(labels)
    .set({
      name: change.name?.trim() || current.name,
      description: change.description?.trim() ?? current.description,
      disposition,
      block: extras.block ?? false,
      digest: extras.digest ?? false,
      markRead: extras.markRead ?? false,
      unsubscribe: change.unsubscribe ?? current.unsubscribe ?? false,
    })
    .where(eq(labels.id, id));
  return true;
}

/** Record that the model is being asked for labels, before the call. Returns the row's id. */
export async function startLabelProposal(db: Sql, request: { accountId: string; goal: string; model: string; now: number }): Promise<number> {
  const [row] = await db
    .insert(labelProposals)
    .values({
      accountId: request.accountId,
      startedAt: request.now,
      model: request.model,
      goal: sealJson(db, labelProposalName(db, request.accountId, 'goal'), request.goal),
    })
    .returning({ id: labelProposals.id });
  return row!.id;
}

/** What the call suggested, or why it failed, and what it cost. */
export async function finishLabelProposal(
  db: Sql,
  accountId: string,
  id: number,
  outcome: ({ drafts: LabelDraft[]; note?: string } | { error: string }) & { usage?: Usage; now: number },
): Promise<void> {
  await db
    .update(labelProposals)
    .set({
      finishedAt: outcome.now,
      ...('drafts' in outcome
        ? {
            labels: sealJson(db, labelProposalName(db, accountId, 'labels'), outcome.drafts),
            ...(outcome.note ? { note: sealJson(db, labelProposalName(db, accountId, 'note'), outcome.note) } : {}),
          }
        : { error: outcome.error }),
      ...costOf(outcome.usage),
    })
    .where(eq(labelProposals.id, id));
}

/** The latest proposal for any of these mailboxes that suggested something, so it survives a reload. */
export async function latestLabelProposal(
  db: Sql,
  accountIds: readonly string[],
): Promise<{ id: number; goal: Confidential; drafts: Sealed<LabelDraft[]>; note?: Confidential; at: number } | null> {
  if (accountIds.length === 0) return null;
  const [row] = await db
    .select({
      id: labelProposals.id,
      accountId: labelProposals.accountId,
      goal: labelProposals.goal,
      labels: labelProposals.labels,
      note: labelProposals.note,
      at: labelProposals.startedAt,
    })
    .from(labelProposals)
    .where(and(inArray(labelProposals.accountId, [...accountIds]), isNotNull(labelProposals.labels)))
    .orderBy(desc(labelProposals.startedAt), desc(labelProposals.id))
    .limit(1);
  if (!row?.labels) return null;
  return {
    id: row.id,
    goal: openJson<string>(db, labelProposalName(db, row.accountId, 'goal'), row.goal),
    drafts: openJson<LabelDraft[]>(db, labelProposalName(db, row.accountId, 'labels'), row.labels),
    ...(row.note === null ? {} : { note: openJson<string>(db, labelProposalName(db, row.accountId, 'note'), row.note) }),
    at: row.at,
  };
}
