'use client';
import { type AnswerLabel, answerChoices, useListAnswer, withDoes } from '@/components/answer.tsx';
import { WhoWrote } from '@/components/mail.tsx';
import { sureness } from '@/lib/words.ts';
import { reveal } from '@/lib/reveal.ts';
import { type Ending, LabelPick, LabelSheet } from '@/system';
import { type Listed, newest } from './listed.ts';

/** What an answer about the conversation is about: the newest message Mild decided on, or its newest. */
function targetOf(thread: Listed) {
  const { thinks } = thread;
  return {
    accountId: thread.accountId,
    threadId: thread.threadId,
    sender: reveal(thread.from),
    subject: reveal(thread.subject),
    messageId: thinks?.messageId ?? newest(thread).messageId,
    labelId: thinks?.labelId ?? null,
    ...(thinks ? { decisionId: thinks.decisionId } : {}),
  };
}

/** What Mild thinks the conversation is, as a dropdown that says it otherwise (`useListAnswer`). Mail Mild never placed is answered all the same. */
export function Label({ thread, labels, ending }: { thread: Listed; labels: readonly AnswerLabel[]; ending: Ending }) {
  const answer = useListAnswer(labels);
  const { thinks } = thread;
  const target = targetOf(thread);
  return (
    <LabelPick
      label={`What ${reveal(thread.subject) || '(no subject)'} is`}
      value={thinks?.labelId ?? null}
      groups={answerChoices(labels, target, thinks ? sureness(thinks) : 1, [])}
      onSubmit={(id) => answer(target, id)}
      ending={ending}
    />
  );
}

/** On a phone, what the conversation swiped right is, picked from every label (`LabelSheet`), as `Label` says it on a computer. */
export function LabelSheetFor({ thread, labels, ending, onClose }: { thread: Listed; labels: readonly AnswerLabel[]; ending: Ending; onClose: () => void }) {
  const answer = useListAnswer(labels);
  const { thinks } = thread;
  const target = targetOf(thread);
  return (
    <LabelSheet
      open
      onClose={onClose}
      who={<WhoWrote writers={thread.who} />}
      subject={reveal(thread.subject) || '(no subject)'}
      value={thinks?.labelId ?? null}
      groups={withDoes(labels, answerChoices(labels, target, thinks ? sureness(thinks) : 1, []))}
      onPick={(id) => void answer(target, id).catch(() => undefined)}
      ending={ending}
    />
  );
}
