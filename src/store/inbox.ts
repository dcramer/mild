import { and, avg, count, decisions, desc, eq, gte, inArray, inboxRuns, isNotNull, isNull, modelRuns, sql, sum } from './query.ts';
import type { Sql } from './sql.ts';

/**
 * How many of a mailbox's newest messages one press goes through. `inbox` bounds what one press can spend
 * on model calls; `recent` is enough to teach with while setting up.
 */
export const REACH = { inbox: 10_000, recent: 300 } as const;
export type Reach = keyof typeof REACH;

export interface InboxRun {
  id: number;
  accountId: string;
  startedAt: number;
  acts: boolean;
  most: number;
  listed: boolean;
  pageToken: string | null;
  messages: string[];
  next: number;
}

const COLUMNS = {
  id: inboxRuns.id,
  accountId: inboxRuns.accountId,
  startedAt: inboxRuns.startedAt,
  acts: inboxRuns.acts,
  most: inboxRuns.most,
  listed: inboxRuns.listed,
  pageToken: inboxRuns.pageToken,
  messages: inboxRuns.messages,
  next: inboxRuns.next,
};

/** Start going through each of these mailboxes, except one already being gone through. Returns how many started. */
export async function startInboxRuns(db: Sql, accountIds: readonly string[], run: { acts: boolean; most: number; now: number }): Promise<number> {
  if (accountIds.length === 0) return 0;
  const started = await db
    .insert(inboxRuns)
    .values(accountIds.map((accountId) => ({ accountId, startedAt: run.now, acts: run.acts, most: run.most })))
    .onConflictDoNothing()
    .returning({ id: inboxRuns.id });
  return started.length;
}

/** The runs still going, for what a tick has to do. */
export async function goingInboxRuns(db: Sql): Promise<{ id: number; accountId: string }[]> {
  return await db.select({ id: inboxRuns.id, accountId: inboxRuns.accountId }).from(inboxRuns).where(isNull(inboxRuns.finishedAt));
}

/** A run that is still going, or null once it has finished or been stopped. */
export async function goingInboxRun(db: Sql, id: number): Promise<InboxRun | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(inboxRuns)
    .where(and(eq(inboxRuns.id, id), isNull(inboxRuns.finishedAt)));
  return row ?? null;
}

/** Whether a run is still going: not finished, and not stopped from the page. */
export async function isGoing(db: Sql, id: number): Promise<boolean> {
  const [row] = await db
    .select({ id: inboxRuns.id })
    .from(inboxRuns)
    .where(and(eq(inboxRuns.id, id), isNull(inboxRuns.finishedAt)));
  return row !== undefined;
}

/** Add a page of the inbox to what the run goes through. `pageToken` is where the next page starts: null when none does. */
export async function addListed(db: Sql, run: InboxRun, ids: readonly string[], pageToken: string | null): Promise<InboxRun> {
  const messages = [...run.messages, ...ids.filter((id) => !run.messages.includes(id))].slice(0, run.most);
  const listed = pageToken === null || messages.length >= run.most;
  await db
    .update(inboxRuns)
    .set({ messages, listed, pageToken: listed ? null : pageToken })
    .where(eq(inboxRuns.id, run.id));
  return { ...run, messages, listed, pageToken: listed ? null : pageToken };
}

/** How far the run has got; at the end of its messages it is finished. */
export async function advanceInboxRun(db: Sql, run: InboxRun, next: number, now: number): Promise<void> {
  // Counted even when the person stopped it meanwhile, since what it decided stays decided.
  await db.update(inboxRuns).set({ next }).where(eq(inboxRuns.id, run.id));
  if (next >= run.messages.length)
    await db
      .update(inboxRuns)
      .set({ finishedAt: now })
      .where(and(eq(inboxRuns.id, run.id), isNull(inboxRuns.finishedAt)));
}

/** Stop every run of this person's that is still going. What has been decided stays decided. */
export async function stopInboxRuns(db: Sql, now: number): Promise<void> {
  await db.update(inboxRuns).set({ finishedAt: now, stopped: true }).where(isNull(inboxRuns.finishedAt));
}

/** What the model has cost going through one run's messages. */
async function spentOn(db: Sql, run: { id: number; accountId: string; startedAt: number; finishedAt: number | null }): Promise<number> {
  const listed = db
    .select({ id: sql<string>`jsonb_array_elements_text(${inboxRuns.messages})` })
    .from(inboxRuns)
    .where(eq(inboxRuns.id, run.id));
  const [row] = await db
    .select({ spent: sum(modelRuns.costUsd).mapWith(Number) })
    .from(modelRuns)
    .where(
      and(
        eq(modelRuns.accountId, run.accountId),
        gte(modelRuns.startedAt, run.startedAt),
        run.finishedAt === null ? undefined : sql`${modelRuns.startedAt} <= ${run.finishedAt}`,
        inArray(modelRuns.messageId, listed),
      ),
    );
  return row?.spent ?? 0;
}

export interface InboxProgress {
  /** Going through these mailboxes now, all of them together. `listed` false: still reading what is in them. */
  going: { listed: boolean; done: number; total: number; spent: number; startedAt: number } | null;
  /** The last time, when nothing is going. */
  last: { finishedAt: number; total: number; spent: number; stopped: boolean } | null;
}

/** Where going through these mailboxes has got, or how it last went. */
export async function inboxProgress(db: Sql, accountIds: readonly string[]): Promise<InboxProgress> {
  if (accountIds.length === 0) return { going: null, last: null };
  const rows = await db
    .select({
      id: inboxRuns.id,
      accountId: inboxRuns.accountId,
      startedAt: inboxRuns.startedAt,
      finishedAt: inboxRuns.finishedAt,
      stopped: inboxRuns.stopped,
      listed: inboxRuns.listed,
      next: inboxRuns.next,
      total: sql<number>`jsonb_array_length(${inboxRuns.messages})`.mapWith(Number),
    })
    .from(inboxRuns)
    .where(inArray(inboxRuns.accountId, [...accountIds]))
    .orderBy(desc(inboxRuns.id));
  const going = rows.filter((r) => r.finishedAt === null);
  if (going.length > 0) {
    const spent = await Promise.all(going.map((r) => spentOn(db, r)));
    return {
      going: {
        listed: going.every((r) => r.listed),
        done: going.reduce((n, r) => n + r.next, 0),
        total: going.reduce((n, r) => n + r.total, 0),
        spent: spent.reduce((a, b) => a + b, 0),
        startedAt: Math.min(...going.map((r) => r.startedAt)),
      },
      last: null,
    };
  }
  const latest = rows[0];
  if (!latest) return { going: null, last: null };
  // The mailboxes started by the same press.
  const press = rows.filter((r) => r.startedAt === latest.startedAt);
  const spent = await Promise.all(press.map((r) => spentOn(db, r)));
  return {
    going: null,
    last: {
      finishedAt: Math.max(...press.map((r) => r.finishedAt ?? 0)),
      total: press.reduce((n, r) => n + (r.stopped ? r.next : r.total), 0),
      spent: spent.reduce((a, b) => a + b, 0),
      stopped: press.some((r) => r.stopped),
    },
  };
}

/** Too few to go by, and an estimate falls back to the model's catalogue price or to every message needing the model. */
const ENOUGH = 20;

/** What one model call has cost this person on `model` lately, or null with too few calls to say. */
export async function costPerCall(db: Sql, model: string): Promise<number | null> {
  const recent = db
    .select({ cost: modelRuns.costUsd })
    .from(modelRuns)
    .where(and(eq(modelRuns.model, model), isNotNull(modelRuns.finishedAt), isNull(modelRuns.error)))
    .orderBy(desc(modelRuns.id))
    .limit(200)
    .as('recent');
  const [row] = await db.select({ n: count(), cost: avg(recent.cost).mapWith(Number) }).from(recent);
  return row && row.n >= ENOUGH ? row.cost : null;
}

/** Of this person's decisions since `since`, the share a model was asked for; null with too few to say. */
export async function modelShare(db: Sql, since: number): Promise<number | null> {
  const [row] = await db
    .select({ n: count(), asked: count(decisions.runId) })
    .from(decisions)
    .where(gte(decisions.decidedAt, since));
  return row && row.n >= ENOUGH ? row.asked / row.n : null;
}
