import { api, useAction } from '@/lib/api.ts';
import { INBOX, outcomeName, plural } from '@/lib/format.ts';
import { Meter, type Pick, useToast } from '@/system';

/** A message whose label the user can say, as the list and the panel both hold it. */
export interface Answerable {
  accountId: string;
  sender: string;
  messageId: string;
  /** Absent for mail sift never decided: the answer is its first decision. */
  decisionId?: number;
  /** The label sift gave, if any. */
  labelId: string | null;
}

export interface AnswerLabel {
  id: string;
  name: string;
  disposition: string;
}

/**
 * Saying what one message is, like a spam button with more than two outcomes: sift records it, does what
 * that label does to the message in Gmail, and keeps it as an example. No rule is made. When the sender
 * has other mail waiting that sift guessed the same way, the toast offers the same answer for those.
 */
export function useAnswer(labels: readonly AnswerLabel[], waiting: readonly Answerable[], onDone: () => void) {
  const { busy, error, run } = useAction();
  const toast = useToast();
  const say = (target: Answerable, labelId: string) =>
    api.feedback({
      accountId: target.accountId,
      sender: target.sender,
      messageId: target.messageId,
      ...(target.decisionId === undefined ? {} : { decisionId: target.decisionId }),
      label: labelId,
    });

  /** The answer, as every list says it: "Archive as Marketing", or "Left in your inbox". */
  const saying = (labelId: string) => {
    if (labelId === INBOX) return 'Left in your inbox';
    const label = labels.find((l) => l.id === labelId);
    return label ? `${outcomeName(label.disposition)} as ${label.name}` : 'Answered';
  };

  const answer = (target: Answerable, labelId: string) =>
    run(async () => {
      const reply = await say(target, labelId);
      // The answer is saved; what sift itself did to the message could not be taken back in Gmail.
      if (reply.notFixed !== null) toast('Could not put the message back in Gmail', { tone: 'failure', description: reply.notFixed });
      const alike = waiting.filter((w) => w.messageId !== target.messageId && w.sender === target.sender && w.labelId === target.labelId);
      const said = saying(labelId);
      toast(
        said,
        alike.length > 0
          ? {
              action: {
                label: `Same for ${alike.length} more`,
                // Pressed later, maybe after this message's row or panel has gone: so it refreshes what is shown, and never
                // calls `onDone`, which would move or close a panel the reader has since moved on in.
                onPress: () =>
                  run(async () => {
                    try {
                      await Promise.all(alike.map((w) => say(w, labelId)));
                      toast(`${said}: ${alike.length} more`);
                    } catch (failure) {
                      toast('Could not answer the rest', { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) });
                    }
                  }),
              },
            }
          : {},
      );
      onDone();
    });

  /**
   * What a message might be, for the answer's dropdown: Leave in inbox, always first; then sift's label and its
   * other likely ones, each with how sure; then every other label. Leave in inbox has its meter where it is,
   * when it is one of the likely ones.
   */
  const choices = (target: Answerable, sure: 1 | 2 | 3, alternatives: readonly { id: string; name: string; share: number }[]): Pick[][] => {
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
  };

  /** One answer for several messages, as a folded row gives it. */
  const answerAll = (targets: readonly Answerable[], labelId: string) =>
    run(async () => {
      await Promise.all(targets.map((t) => say(t, labelId)));
      toast(`${saying(labelId)}: ${plural(targets.length, 'message')}`);
      onDone();
    });

  return { answer, answerAll, choices, busy, error };
}
