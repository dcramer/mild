import { type Press, press, undo } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import { applyFeedback } from '../learn/feedback.ts';
import { lastStandingChange } from '../store/actions.ts';
import { openEnvelope } from '../store/content.ts';
import { listUnsettledDecisions } from '../store/decisions.ts';
import { listLabels } from '../store/labels.ts';
import { and, asc, decisions, desc, eq, feedback, inArray, messages } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import type { Label } from '../triage/types.ts';
import { plain } from '../plain.ts';
import { reportError } from '../telemetry.ts';
import { carryOutDecision } from './triage.ts';

interface Deps {
  db: Sql;
  mailbox: Mailbox;
  now?: () => number;
}

/**
 * The person's own presses in Inbox. Archive and Spam (Block's too) also settle what each conversation is: the label its
 * row shows becomes their answer about its newest message. Where that label does what was pressed, Mild does the label's
 * own action to that message in its place (its Gmail label, the digest), as picking the label would; otherwise the press
 * goes ahead and the label is only recorded. Each change that landed is returned for Undo.
 */
export async function pressMail(deps: Deps, accountId: string, messageIds: readonly string[], change: Press): Promise<{ actions: number[]; missed: number }> {
  const landed: number[] = [];
  let missed = 0;
  const done = new Set<string>();
  if (change === 'archive' || change === 'spam') {
    for (const shown of await shownLabels(deps.db, accountId, messageIds)) {
      try {
        const actionId = await settleLabel(deps, accountId, shown, change);
        if (actionId === null) continue;
        landed.push(actionId);
        done.add(shown.messageId);
      } catch (error) {
        // The press still goes ahead: what the mail is was not saved, which is no reason to leave it in the inbox.
        reportError(error);
      }
    }
  }
  for (const messageId of messageIds) {
    if (done.has(messageId)) continue;
    try {
      const outcome = await press(deps, accountId, messageId, change);
      // A change whose answer was lost may have landed: Undo is offered, and settles it from Gmail first.
      if (outcome.status === 'done' || outcome.status === 'unknown') landed.push(outcome.actionId);
      else if (outcome.status !== 'skipped') missed++;
    } catch (error) {
      reportError(error);
      missed++;
    }
  }
  return { actions: landed, missed };
}

interface Shown {
  messageId: string;
  sender: string;
  label: Label;
}

/**
 * Saves `shown.label` as the answer about its message, and where the label does what was pressed, carries it out now.
 * The change made, or null when the press is still to be made.
 */
async function settleLabel(deps: Deps, accountId: string, shown: Shown, change: 'archive' | 'spam'): Promise<number | null> {
  const { db, mailbox } = deps;
  const now = (deps.now ?? Date.now)();
  const carry = shown.label.disposition === change;
  const result = await applyFeedback(db, { accountId, sender: shown.sender, label: shown.label.id, messageId: shown.messageId, carryOut: carry }, now);
  // What Mild did to the message is taken back first, as for any answer: its review mark, or its change to a corrected one.
  for (const messageId of [...result.asked, ...(result.corrected === null ? [] : [result.corrected])]) {
    const last = await lastStandingChange(db, accountId, messageId);
    if (last) await undo(deps, last.id);
  }
  if (!carry) return null;
  const decision = (await listUnsettledDecisions(db, accountId)).findLast((d) => d.messageId === shown.messageId);
  if (!decision) return null;
  const carried = await carryOutDecision(deps, accountId, decision.id, shown.messageId, decision, mailbox);
  // Refused (spam for someone they write to) or not landed: the press is made as pressed, and the pass tries the label again.
  return carried.status === 'done' && carried.actionId !== undefined ? carried.actionId : null;
}

/**
 * The label each pressed conversation's row shows, about its newest message in the inbox, as Inbox draws it: that message's
 * newest decision, or the person's answer to it. Only for one that was pressed; a conversation Mild never placed has none.
 */
async function shownLabels(db: Sql, accountId: string, messageIds: readonly string[]): Promise<Shown[]> {
  if (messageIds.length === 0) return [];
  const threads = await db
    .selectDistinct({ threadId: messages.threadId })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), inArray(messages.id, [...messageIds])));
  if (threads.length === 0) return [];
  const all = await db
    .select({ id: messages.id, threadId: messages.threadId, labelIds: messages.labelIds, headers: messages.headers })
    .from(messages)
    .where(
      and(
        eq(messages.accountId, accountId),
        inArray(
          messages.threadId,
          threads.map((t) => t.threadId),
        ),
      ),
    )
    .orderBy(asc(messages.receivedAt), asc(messages.id));
  const inInbox = all.filter((m) => m.labelIds.includes('INBOX'));
  const newest = [...new Map(inInbox.map((m) => [m.threadId, m])).values()].filter((m) => messageIds.includes(m.id));
  if (newest.length === 0) return [];
  const labels = await listLabels(db);
  const shown: Shown[] = [];
  for (const m of newest) {
    const [row] = await db
      .select({ labelId: decisions.labelId, answered: feedback.labelId })
      .from(decisions)
      .leftJoin(feedback, eq(feedback.decisionId, decisions.id))
      .where(and(eq(decisions.accountId, accountId), eq(decisions.messageId, m.id)))
      .orderBy(desc(decisions.id))
      .limit(1);
    const label = labels.find((l) => l.id === (row?.answered ?? row?.labelId));
    if (label) shown.push({ messageId: m.id, sender: plain(openEnvelope(db, accountId, m.id, { headers: m.headers }).fromAddress), label });
  }
  return shown;
}
