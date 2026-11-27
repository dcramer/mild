'use client';
import { useAction } from '@/components/action.ts';
import { useAnswer, useRecordAnswer } from '@/components/answer.tsx';
import { useLabelEnding } from '@/components/label-ending.tsx';
import { type MessageDetail, type RuleMatch, api } from '@/lib/api/endpoints.ts';
import { useManage, useSuggestion } from '@/lib/api/reads.ts';
import { reveal } from '@/lib/reveal.ts';
import { messageStart } from '@/lib/rule-start.ts';
import { messageKey } from '@/lib/rows.ts';
import { sureness } from '@/lib/words.ts';
import { useToast } from '@/system';

/**
 * What the message is and the presses that answer it: `record` saves the answer and the conversation stays, as Inbox's
 * list does; `answer` returns to the list. `waiting` is the sender's other mail waiting on an answer, answered
 * with it, and `keepable` the label a rule could keep their mail of anyway.
 */
export function useWhatItIs(detail: MessageDetail, onAnswered: () => void) {
  const waiting = useSuggestion(reveal(detail.fromAddress));
  const manage = useManage();
  const toast = useToast();
  const current = detail.decisions.at(-1);
  // What the message is, as every list shows it: the user's answer where they gave one, else Mild's.
  const shownLabel = current?.answer ? current.answer.labelId : (current?.labelId ?? null);
  const labels = manage.data?.labels ?? [];
  // Mail Mild never decided (the model could not judge it) is answered all the same.
  const target = {
    accountId: detail.accountId,
    sender: reveal(detail.fromAddress),
    subject: reveal(detail.subject),
    messageId: detail.messageId,
    labelId: current?.labelId ?? null,
    ...(current ? { decisionId: current.id } : {}),
  };
  const { answer, choices } = useAnswer(
    labels,
    async () =>
      (await waiting.ready()).messages.map((m) => ({
        accountId: m.accountId,
        sender: reveal(detail.fromAddress),
        subject: reveal(m.subject),
        messageId: m.messageId,
        decisionId: m.decisionId,
        labelId: m.labelId,
      })),
    onAnswered,
  );
  const record = useRecordAnswer();
  // What else it might be: the labels the sender's other mail has had, most first.
  const total = detail.sender.labels.reduce((sum, l) => sum + l.messages, 0);
  const alternatives = detail.sender.labels
    .filter((l) => l.id !== current?.labelId)
    .slice(0, 2)
    .map((l) => ({ id: l.id, name: l.name, share: total ? l.messages / total : 0 }));
  // Mail that is what Mild says but matters anyway: a rule keeps the sender's mail of that kind, and this message with it.
  const given = labels.find((l) => l.id === current?.labelId);
  const keepable = given && current?.disposition !== 'keep' && given.disposition !== 'keep' && given.disposition !== 'review' ? given : null;
  // A rule covers mail from here on; this message, which may already have been moved, is answered as the rule would.
  const keep = useAction();
  const covers = (match: RuleMatch) =>
    Object.keys(match).length === 1 &&
    ((match.from ?? []).includes(reveal(detail.fromAddress)) || (match.fromDomain ?? []).includes(reveal(detail.fromAddress).split('@')[1] ?? ''));
  const keepThis = (labelId: string) => {
    keep.hide([messageKey(detail)], 'Could not save your answer', async () => {
      const reply = await api.feedback({
        accountId: detail.accountId,
        sender: reveal(detail.fromAddress),
        messageId: detail.messageId,
        ...(current ? { decisionId: current.id } : {}),
        label: labelId,
        disposition: 'keep',
      });
      if (reply.notFixed !== null) toast('Could not put the message back in Gmail', { tone: 'failure', description: reply.notFixed });
    });
    onAnswered();
  };
  // The rule dialog, opened in place on what this message shows: its sender and label, or one thing Mild saw in it.
  const { ending, openRule, dialogs } = useLabelEnding(
    labels,
    () => messageStart(reveal(detail.fromAddress), shownLabel),
    (match, rule) => {
      if (rule.whenLabel !== undefined && rule.whenLabel === current?.labelId && rule.disposition === 'keep' && covers(match)) keepThis(rule.whenLabel);
    },
  );
  return {
    current,
    shownLabel,
    labels,
    waiting,
    groups: choices(target, current ? sureness(current) : 1, alternatives),
    record: (labelId: string) => record(target, labelId),
    answer: (labelId: string) => answer(target, labelId),
    keepable,
    ending,
    openRule,
    dialogs,
  };
}
