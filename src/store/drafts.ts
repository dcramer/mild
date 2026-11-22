import type { Sealed } from '../confidential.ts';
import { plain } from '../plain.ts';
import { draftName, openJson, sealJson } from './content.ts';
import { and, asc, drafts, eq, isNotNull, isNull, lt, lte, or, sql } from './query.ts';
import type { Sql } from './sql.ts';

/** What the composer saves (`DraftWriting`, src/dashboard/types.ts), kept here without the API's types. */
export interface Writing {
  of: { kind: 'new' } | { kind: 'reply'; messageId: string; all: boolean } | { kind: 'forward'; messageId: string };
  from: string;
  to: { address: string; name?: string; wrong?: true }[];
  cc: { address: string; name?: string; wrong?: true }[];
  bcc: { address: string; name?: string; wrong?: true }[];
  showCc: boolean;
  showBcc: boolean;
  subject: string;
  text: string;
  files: { id: string; name: string; size: number; added: number }[];
  dropped: string[];
  withFiles?: boolean;
  editSubject?: boolean;
  id: string | null;
  at: number;
}

export interface Saved {
  id: string;
  accountId: string;
  writing: Sealed<Writing>;
  changedAt: number;
  gmailId: string | null;
  pushedAt: number | null;
  sendAt: number | null;
  sendError: string | null;
}

const savedOf = (db: Sql, r: typeof drafts.$inferSelect): Saved => ({
  id: r.id,
  accountId: r.accountId,
  writing: opened(db, r),
  changedAt: r.changedAt,
  gmailId: r.gmailId,
  pushedAt: r.pushedAt,
  sendAt: r.sendAt,
  sendError: r.sendError,
});

const opened = (db: Sql, row: { id: string; writing: string }) => openJson<Writing>(db, draftName(db, row.id), row.writing);

/**
 * Keep what the composer holds now, unless what is kept is newer (another device saved it since), to send at `sendAt`
 * when given: a draft changed is no longer scheduled, as in Gmail. Returns the mailbox it was saved under before, with its
 * id in Gmail's Drafts, when it moved to another: that draft goes.
 */
export async function saveDraft(
  db: Sql,
  draft: { id: string; accountId: string; writing: Writing; sendAt?: number | undefined },
  now: number,
): Promise<{ accountId: string; gmailId: string } | null> {
  const [was] = await db.select({ accountId: drafts.accountId, writing: drafts.writing, gmailId: drafts.gmailId }).from(drafts).where(eq(drafts.id, draft.id));
  if (was && plain(opened(db, { id: draft.id, writing: was.writing })).at > draft.writing.at) return null;
  const moved = was && was.accountId !== draft.accountId && was.gmailId ? { accountId: was.accountId, gmailId: was.gmailId } : null;
  const row = {
    accountId: draft.accountId,
    writing: sealJson(db, draftName(db, draft.id), draft.writing),
    uploads: draft.writing.files.map((f) => f.id),
    changedAt: now,
    sendAt: draft.sendAt ?? null,
    sendError: null,
  };
  await db
    .insert(drafts)
    .values({ id: draft.id, ...row })
    .onConflictDoUpdate({ target: [drafts.userId, drafts.id], set: { ...row, ...(moved ? { gmailId: null, pushedAt: null } : {}) } });
  return moved;
}

/** Forget a draft, sent or discarded. Returns where it was in Gmail's Drafts, for that to go too. */
export async function removeDraft(db: Sql, id: string): Promise<{ accountId: string; gmailId: string | null } | null> {
  const [gone] = await db.delete(drafts).where(eq(drafts.id, id)).returning({ accountId: drafts.accountId, gmailId: drafts.gmailId });
  return gone ?? null;
}

export async function listDrafts(db: Sql, accounts: readonly string[]): Promise<Saved[]> {
  const rows = await db.select().from(drafts).orderBy(asc(drafts.changedAt));
  return rows.filter((r) => accounts.includes(r.accountId)).map((r) => savedOf(db, r));
}

/** Changed since Gmail last had it, and left alone since `quietSince`. */
const behind = (quietSince: number) => and(or(isNull(drafts.pushedAt), lt(drafts.pushedAt, drafts.changedAt)), lte(drafts.changedAt, quietSince));

/** Scheduled to go by `now`. */
const due = (now: number) => and(isNotNull(drafts.sendAt), lte(drafts.sendAt, now));

export async function scheduledDue(db: Sql, accountId: string, now: number): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(drafts)
    .where(and(eq(drafts.accountId, accountId), due(now)))
    .limit(1);
  return row !== undefined;
}

export async function scheduledBy(db: Sql, accountId: string, now: number): Promise<Saved[]> {
  return (
    await db
      .select()
      .from(drafts)
      .where(and(eq(drafts.accountId, accountId), due(now)))
  ).map((r) => savedOf(db, r));
}

/** A scheduled send that will not go until the person puts it right: a draft again, saying why. */
export async function failSchedule(db: Sql, id: string, why: string): Promise<void> {
  await db.update(drafts).set({ sendAt: null, sendError: why }).where(eq(drafts.id, id));
}

export async function draftsDue(db: Sql, accountId: string, quietSince: number): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(drafts)
    .where(and(eq(drafts.accountId, accountId), behind(quietSince)))
    .limit(1);
  return row !== undefined;
}

export async function draftsBehind(db: Sql, accountId: string, quietSince: number): Promise<Saved[]> {
  const rows = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.accountId, accountId), behind(quietSince)));
  return rows.map((r) => savedOf(db, r));
}

/** Gmail has the draft as it was at `changedAt`. A change made while it was being pushed leaves it behind still. */
export async function markPushed(db: Sql, id: string, changedAt: number, gmailId: string): Promise<void> {
  await db.update(drafts).set({ gmailId, pushedAt: changedAt }).where(eq(drafts.id, id));
}

/** Upload ids a draft still holds, which the day's upkeep keeps. */
export async function heldUploads(db: Sql): Promise<Set<string>> {
  const rows = await db.select({ uploads: drafts.uploads }).from(drafts).where(isNotNull(drafts.uploads));
  return new Set(rows.flatMap((r) => r.uploads));
}
