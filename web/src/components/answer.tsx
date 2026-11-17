import { api, useAction } from '@/lib/api.ts';
import { outcomeName, plural } from '@/lib/format.ts';
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

  const answer = (target: Answerable, labelId: string) =>
    run(async () => {
      const reply = await say(target, labelId);
      // The answer is saved; what sift itself did to the message could not be taken back in Gmail.
      if (reply.notFixed !== null) toast('Could not put the message back in Gmail', { tone: 'failure', description: reply.notFixed });
      const label = labels.find((l) => l.id === labelId);
      const alike = waiting.filter((w) => w.messageId !== target.messageId && w.sender === target.sender && w.labelId === target.labelId);
      // The verdict, as every list says it: "Archive as Marketing".
      const said = label ? `${outcomeName(label.disposition)} as ${label.name}` : 'Answered';
      toast(
        said,
        alike.length > 0
          ? {
              action: {
                label: `Same for ${alike.length} more`,
                onPress: () =>
                  void Promise.all(alike.map((w) => say(w, labelId))).then(
                    () => {
                      toast(`${said}: ${alike.length} more`);
                      onDone();
                    },
                    (failure: unknown) =>
                      toast('Could not answer the rest', { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) }),
                  ),
              },
            }
          : {},
      );
      onDone();
    });

  /**
   * What a message might be, for the answer's dropdown: sift's label and its other likely ones, each with
   * how sure, then every other label.
   */
  const choices = (target: Answerable, sure: 1 | 2 | 3, alternatives: readonly { id: string; name: string; share: number }[]): Pick[][] => {
    const guess = labels.find((l) => l.id === target.labelId);
    const likely = [
      ...(guess ? [{ id: guess.id, label: guess.name, lead: <Meter level={sure} /> }] : []),
      ...alternatives.filter((a) => a.id !== target.labelId).map((a) => ({ id: a.id, label: a.name, lead: <Meter level={a.share >= 0.5 ? 2 : 1} /> })),
    ];
    const rest = labels.filter((l) => !likely.some((p) => p.id === l.id)).map((l) => ({ id: l.id, label: l.name }));
    return [likely, rest];
  };

  /** One answer for several messages, as a folded row gives it. */
  const answerAll = (targets: readonly Answerable[], labelId: string) =>
    run(async () => {
      await Promise.all(targets.map((t) => say(t, labelId)));
      const label = labels.find((l) => l.id === labelId);
      toast(`${label ? `${outcomeName(label.disposition)} as ${label.name}` : 'Answered'}: ${plural(targets.length, 'message')}`);
      onDone();
    });

  return { answer, answerAll, choices, busy, error };
}
