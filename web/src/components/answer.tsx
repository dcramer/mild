import { api, useAction } from '@/lib/api.ts';
import { willBe } from '@/lib/format.ts';
import { Meter, type Pick, useToast } from '@/system';

/** A message whose label the user can say, as the list and the panel both hold it. */
export interface Answerable {
  accountId: string;
  sender: string;
  messageId: string;
  decisionId: number;
  /** The label sift gave, if any. */
  labelId: string | null;
}

export interface AnswerLabel {
  id: string;
  name: string;
  disposition: string;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

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
      decisionId: target.decisionId,
      scope: 'once',
      label: labelId,
    });

  const answer = (target: Answerable, labelId: string) =>
    run(async () => {
      await say(target, labelId);
      const label = labels.find((l) => l.id === labelId);
      const alike = waiting.filter((w) => w.messageId !== target.messageId && w.sender === target.sender && w.labelId === target.labelId);
      toast(
        label ? `${capital(willBe(label.disposition))} as ${label.name}` : 'Noted',
        alike.length > 0
          ? {
              action: {
                label: `Same for ${alike.length} more`,
                onPress: () =>
                  void Promise.all(alike.map((w) => say(w, labelId))).then(
                    () => {
                      toast(`Done for ${alike.length} more from ${target.sender}`);
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

  return { answer, choices, busy, error };
}
