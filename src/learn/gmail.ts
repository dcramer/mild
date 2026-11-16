import { actions, and, decisions, desc, eq, feedback, gte, isNotNull, messages, ne } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import { listLabels } from '../store/labels.ts';
import type { DecidedDisposition } from '../triage/types.ts';
import { applyFeedback } from './feedback.ts';

/** Labels put on or taken off one message in Gmail. */
interface MessageChange {
  messageId: string;
  added: string[];
  removed: string[];
}

/**
 * The part of Gmail's history that sift did not cause: what the user (or another client of theirs) did.
 * History does not say who made a change, so each of sift's own logged changes since `since` cancels one
 * matching entry, and what is left over is the user's. `since` is when the previous sync began: nothing
 * sift did before then can still be in this history, and counting an older action could hide a real change.
 * One entry per message, each label listed once.
 */
export async function userChanges(db: Sql, accountId: string, history: readonly MessageChange[], since: number): Promise<MessageChange[]> {
  if (history.length === 0) return [];
  // messageId -> "+LABEL" or "-LABEL" -> how many times more than sift did it
  const tally = new Map<string, Map<string, number>>();
  const count = (messageId: string, key: string, by: number) => {
    const counts = tally.get(messageId) ?? new Map<string, number>();
    counts.set(key, (counts.get(key) ?? 0) + by);
    tally.set(messageId, counts);
  };
  for (const change of history) {
    for (const label of change.added) count(change.messageId, `+${label}`, 1);
    for (const label of change.removed) count(change.messageId, `-${label}`, 1);
  }
  // A change whose outcome was never confirmed may have landed, so it counts; one that failed did not.
  const own = await db
    .select({ messageId: actions.messageId, payload: actions.payload })
    .from(actions)
    .where(and(eq(actions.accountId, accountId), isNotNull(actions.messageId), gte(actions.createdAt, since), ne(actions.status, 'failed')));
  for (const action of own) {
    const messageId = action.messageId!;
    if (!tally.has(messageId)) continue;
    for (const label of action.payload.add) count(messageId, `+${label}`, -1);
    for (const label of action.payload.remove) count(messageId, `-${label}`, -1);
  }

  const changes: MessageChange[] = [];
  for (const [messageId, counts] of tally) {
    const left = [...counts].filter(([, n]) => n > 0).map(([key]) => key);
    const added = left.filter((key) => key.startsWith('+')).map((key) => key.slice(1));
    const removed = left.filter((key) => key.startsWith('-')).map((key) => key.slice(1));
    if (added.length > 0 || removed.length > 0) changes.push({ messageId, added, removed });
  }
  return changes;
}

/** What correction detection reads from Gmail. Nothing here changes the mailbox. */
interface GmailState {
  getLabelIds(messageId: string): Promise<string[] | null>;
  listLabels(): Promise<{ id: string; name: string }[]>;
}

const SYSTEM = new Set(['INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'CHAT']);
const isUserLabel = (id: string) => !SYSTEM.has(id) && !id.startsWith('CATEGORY_');
const moves = (labels: string[]) => labels.includes('INBOX') || labels.includes('SPAM');

/**
 * Treat what the user did to a message in Gmail as their answer about that one message: moving it back
 * to the inbox or out of spam, archiving it or marking it spam, or giving it a different `sift/…` label.
 * `changes` must be the user's own (see `userChanges`). Where the message is now, read fresh, is what
 * they want; a move alone does not say what the mail is, so it keeps the label sift gave it and records
 * the different outcome. The answer is recorded as the dashboard's "only this one" is: never a rule, and
 * nothing is changed in Gmail, since the message is already where the user put it. Mail sift could not
 * place is skipped unless the user labelled it. Safe to run again over the same history.
 * Returns how many answers were recorded.
 */
export async function learnFromGmail(db: Sql, accountId: string, changes: readonly MessageChange[], gmail: GmailState, now: number): Promise<number> {
  const labels = await listLabels(db, accountId);
  let names: Map<string, string> | undefined;
  let learned = 0;

  for (const change of changes) {
    const [decision] = await db
      .select({
        id: decisions.id,
        labelId: decisions.labelId,
        disposition: decisions.disposition,
        carryOut: decisions.carryOut,
        byUser: decisions.byUser,
        fromAddress: messages.fromAddress,
      })
      .from(decisions)
      .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
      .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, change.messageId)))
      .orderBy(desc(decisions.id))
      .limit(1);
    if (!decision) continue;
    const touched = [...change.added, ...change.removed];
    const moved = moves(touched);
    if (!moved && !touched.some(isUserLabel)) continue;
    names ??= new Map((await gmail.listLabels()).map((l) => [l.id, l.name]));
    const siftLabel = (id: string) => labels.find((l) => l.gmailLabel === names?.get(id));
    if (!moved && !touched.some(siftLabel)) continue;

    const current = await gmail.getLabelIds(change.messageId);
    if (current === null || current.includes('TRASH')) continue;
    const place: DecidedDisposition = current.includes('SPAM') ? 'spam' : current.includes('INBOX') ? 'keep' : 'archive';
    const on = current.flatMap((id) => siftLabel(id) ?? []);
    const given = change.added.flatMap((id) => siftLabel(id) ?? []).filter((l) => on.includes(l));
    const label = given.length === 1 ? given[0] : on.length === 1 ? on[0] : labels.find((l) => l.id === decision.labelId);
    if (!label) continue;

    const agrees = decision.labelId === label.id && (decision.disposition === 'review' ? 'keep' : decision.disposition) === place;
    if (agrees) {
      // Doing what sift only suggested confirms it, once. Anything else here is sift's own work or the user's earlier answer, seen again.
      if (
        !moved ||
        decision.carryOut ||
        decision.byUser ||
        (await db.select({ id: feedback.id }).from(feedback).where(eq(feedback.decisionId, decision.id)).limit(1)).length > 0
      )
        continue;
    } else if (
      (
        await db
          .select({ id: feedback.id })
          .from(feedback)
          .where(and(eq(feedback.decisionId, decision.id), eq(feedback.labelId, label.id), eq(feedback.disposition, place)))
          .limit(1)
      ).length > 0
    )
      continue;

    await applyFeedback(
      db,
      {
        accountId,
        sender: decision.fromAddress,
        label: label.id,
        ...(place === label.disposition ? {} : { disposition: place }),
        scope: 'once',
        decisionId: decision.id,
        messageId: change.messageId,
        via: 'gmail',
      },
      now,
    );
    learned++;
  }
  return learned;
}
