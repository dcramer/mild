'use client';
import { api } from '@/lib/api.ts';
import { useAction } from '@/lib/action.ts';
import { copiedKey, leftInbox } from '@/lib/copy.ts';
import { INBOX, MOVES_OUT, labelDid, plural } from '@/lib/format.ts';
import { messageKey, threadKey } from '@/lib/params.ts';
import { type Did, Meter, type Pick, useToast } from '@/system';

/** A message whose label the user can say, as the list and the panel both hold it. */
export interface Answerable {
  accountId: string;
  sender: string;
  /** Revealed, for its toast: the row it was answered from has left the list. */
  subject: string;
  messageId: string;
  /** Absent for mail Mild never decided: the answer is its first decision. */
  decisionId?: number;
  /** The label Mild gave, if any. */
  labelId: string | null;
}

export interface AnswerLabel {
  id: string;
  name: string;
  disposition: string;
}

/**
 * Saying what one message is, like a spam button with more than two outcomes: Mild records it, does what
 * that label does to the message in Gmail, and keeps it as an example. No rule is made. When the sender
 * has other mail waiting that Mild guessed the same way, the toast offers the same answer for those. An answered
 * message leaves the list, and `onDone` is called, as soon as it is pressed. The answer is sent only once its
 * toast goes, so Undo puts the row back with nothing to take back in Gmail or the record.
 */
export function useAnswer(labels: readonly AnswerLabel[], waiting: readonly Answerable[], onDone?: () => void) {
  const { hide } = useAction();
  const toast = useToast();

  /** Takes `targets` off the page, holds them while their toast shows, and then sends them. */
  const send = (targets: readonly Answerable[], labelId: string, action?: { label: string; onPress: () => void }) =>
    hide(targets.map(messageKey), 'Could not save your answer', async () => {
      if (!(await held(toast, titleOf(targets), didOf(labels, labelId), action))) return;
      const replies = await Promise.all(targets.map((t) => api.feedback(feedbackOf(t, labelId))));
      // The answer is saved; what Mild itself did to the message could not be taken back in Gmail.
      const notFixed = replies.find((r) => r.notFixed !== null)?.notFixed;
      if (notFixed) toast('Could not put the message back in Gmail', { tone: 'failure', description: notFixed });
    });

  const answer = (target: Answerable, labelId: string) => {
    const alike = waiting.filter((w) => w.messageId !== target.messageId && w.sender === target.sender && w.labelId === target.labelId);
    send(
      [target],
      labelId,
      alike.length > 0
        ? {
            label: `Same for ${alike.length} more`,
            // Pressed later, maybe after this message's row or panel has gone: so it never calls `onDone`, which
            // would move or close a panel the reader has since moved on in.
            onPress: () => send(alike, labelId),
          }
        : undefined,
    );
    onDone?.();
  };

  const choices = (target: Answerable, sure: 1 | 2 | 3, alternatives: readonly Alternative[]) => answerChoices(labels, target, sure, alternatives);

  /** One answer for several messages, as a folded row gives it. */
  const answerAll = (targets: readonly Answerable[], labelId: string) => {
    send(targets, labelId);
    onDone?.();
  };

  return { answer, answerAll, choices };
}

const feedbackOf = (target: Answerable, labelId: string) => ({
  accountId: target.accountId,
  sender: target.sender,
  messageId: target.messageId,
  ...(target.decisionId === undefined ? {} : { decisionId: target.decisionId }),
  label: labelId,
});

/** What an answer's toast is about: the message, or how many. */
const titleOf = (targets: readonly Answerable[]) => (targets.length === 1 ? targets[0].subject || '(no subject)' : plural(targets.length, 'message'));

/** The answer as its toast draws it: what is done to the mail, and the label it is given. */
function didOf(labels: readonly AnswerLabel[], labelId: string): [Did, ...Did[]] {
  const label = labels.find((l) => l.id === labelId);
  return labelId === INBOX || !label ? [{ action: 'keep', word: 'Left in your inbox' }] : labelDid(label.disposition, label.name);
}

/** Says it with Undo, and resolves with whether to send it: false when Undo was pressed. */
const held = (toast: ReturnType<typeof useToast>, title: string, did: readonly [Did, ...Did[]], action?: { label: string; onPress: () => void }) =>
  new Promise<boolean>((done) => toast(title, { did, ...(action ? { action } : {}), undo: () => done(false), onGone: () => done(true) }));

/** A label the sender's other mail has had, and what share of it. */
interface Alternative {
  id: string;
  name: string;
  share: number;
}

/**
 * What a message might be, for the answer's dropdown: Leave in inbox, always first; then Mild's label and its
 * other likely ones, each with how sure; then every other label. Leave in inbox has its meter where it is,
 * when it is one of the likely ones.
 */
export function answerChoices(
  labels: readonly AnswerLabel[],
  target: { labelId: string | null },
  sure: 1 | 2 | 3,
  alternatives: readonly Alternative[],
): Pick[][] {
  const guess = labels.find((l) => l.id === target.labelId);
  const likely = [
    ...(guess ? [{ id: guess.id, label: guess.name, lead: <Meter level={sure} /> }] : []),
    // A removed label is still in the sender's history, but nothing is given it again.
    ...alternatives
      .filter((a) => a.id !== target.labelId && labels.some((l) => l.id === a.id))
      .map((a) => ({ id: a.id, label: a.name, lead: <Meter level={a.share >= 0.5 ? 2 : 1} /> })),
  ];
  const inbox = labels.find((l) => l.id === INBOX);
  const first = inbox ? [{ id: inbox.id, label: inbox.name, ...likely.find((p) => p.id === INBOX) }] : [];
  const rest = labels.filter((l) => l.id !== INBOX && !likely.some((p) => p.id === l.id)).map((l) => ({ id: l.id, label: l.name }));
  return [first, likely.filter((p) => p.id !== INBOX), rest];
}

/**
 * Saying what a message is in Inbox's reader, where the reader handles their own mail: saved at once and the mail left
 * where it is, since Archive is their press, so picking again is the undo. Resolves once saved; a failure is said in a
 * toast. `carryOut` does what the label does after all, as Inbox's list does for a label that keeps mail.
 */
export function useRecordAnswer(carryOut = false): (target: Answerable, labelId: string) => Promise<void> {
  const { settle } = useAction();
  const toast = useToast();
  return async (target, labelId) => {
    try {
      await settle(async () => {
        const reply = await api.feedback({ ...feedbackOf(target, labelId), carryOut });
        // The answer is saved; Mild's own label on the message could not be taken back in Gmail.
        if (reply.notFixed !== null) toast('Could not put the message back in Gmail', { tone: 'failure', description: reply.notFixed });
      });
    } catch (failure) {
      toast('Could not save your answer', { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) });
      throw failure;
    }
  };
}

/**
 * Saying what a conversation on Inbox's list is, as For review's answer does: about its newest message, and Mild does what
 * the label does to it. Mail the label moves out of the inbox leaves the list at once and is sent once its toast goes; it
 * is kept off the list until the copy shows it moved, which Mild's pass does after the answer is saved. Mail the label
 * keeps stays on the list with its new label, saved at once, so picking again is the undo.
 */
export function useListAnswer(labels: readonly AnswerLabel[]): (target: Answerable & { threadId: string }, labelId: string) => Promise<void> {
  const { hide } = useAction();
  const record = useRecordAnswer(true);
  const toast = useToast();
  return async (target, labelId) => {
    const label = labels.find((l) => l.id === labelId);
    if (!label || !MOVES_OUT.includes(label.disposition)) return await record(target, labelId);
    hide([threadKey(target)], 'Could not save your answer', async () => {
      if (!(await held(toast, titleOf([target]), didOf(labels, labelId)))) return;
      const reply = await api.feedback(feedbackOf(target, labelId));
      // The answer is saved; Mild's own label on the message could not be taken back in Gmail.
      if (reply.notFixed !== null) toast('Could not put the message back in Gmail', { tone: 'failure', description: reply.notFixed });
      await leftInbox([copiedKey(target.accountId, target.threadId)]);
    });
  };
}
