'use client';
import { ArchiveIcon, BanIcon, MailIcon, ReplyIcon, ShieldAlertIcon, TagIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useMailPress } from '@/components/mail.tsx';
import { RuleDialog } from '@/components/rule-dialog.tsx';
import { readMessageAhead, useManage, useMessage } from '@/lib/api/reads.ts';
import { useCompose } from '@/lib/compose.ts';
import type { MessageRef } from '@/lib/open-messages.ts';
import { reveal } from '@/lib/reveal.ts';
import { messageKey } from '@/lib/rows.ts';
import { standingStart } from '@/lib/rule-start.ts';
import { Blank, Loading, Note, Reader, ReaderBar, type Thumb } from '@/system';
import { useConversation } from './conversation.ts';
import { Arriving } from './messages.tsx';
import { OpenedMessage } from './opened-message.tsx';

/**
 * Every list opens a message here, in the list's place: `items` is the list and `index` the one showing, which previous
 * and next follow. `back` names the list, which `onBack` returns to, as does any press that takes the message out of
 * it (an answer, Archive). `onShown` is told which row the message is, for the list to come back to.
 */
export function MessageReader({
  items,
  index,
  back,
  onIndex,
  onBack,
  onShown,
}: {
  items: readonly MessageRef[];
  index: number;
  back: string;
  onIndex: (index: number) => void;
  onBack: () => void;
  onShown: (key: string) => void;
}) {
  const item = items[index];
  // Another message from the same sender, looked at without leaving this place in the list.
  const [picked, setPicked] = useState<Pick<MessageRef, 'accountId' | 'messageId'> | null>(null);
  const [shownAt, setShownAt] = useState(index);
  if (shownAt !== index) {
    setShownAt(index);
    setPicked(null);
  }
  const shown = picked ?? item;
  const { data, error, loading, reload } = useMessage(shown.accountId, shown.messageId);
  const threadId = picked ? undefined : item.threadId;
  const { fromCopy, conversation, thread, markRead } = useConversation(item.accountId, threadId);
  // The conversations either side are read ahead, so previous and next wait on nothing.
  useEffect(() => {
    for (const near of [items[index + 1], items[index - 1]]) if (near?.accountId) readMessageAhead(near.accountId, near.messageId);
  }, [items, index]);
  const { press, block, ruling: blocking, stopRuling } = useMailPress();
  const compose = useCompose();
  // Each message starts at its top, as a page does.
  const go = (to: number) => {
    onIndex(to);
    window.scrollTo(0, 0);
  };
  const pick = (message: Pick<MessageRef, 'accountId' | 'messageId'>) => {
    setPicked(message);
    window.scrollTo(0, 0);
  };
  // The message leaves the list, so the list comes back on the row that takes its place.
  const done = () => {
    const near = items[index + 1] ?? items[index - 1];
    if (near?.accountId) onShown(messageKey(near));
    onBack();
  };
  // The copy has all a press needs before the message has loaded.
  const subject = data?.subject ?? fromCopy?.conversation.messages.at(-1)?.subject;
  const manage = useManage();
  // What the message is, as its row shows it, which Archive gives it where the label archives too.
  const current = data?.decisions.at(-1);
  const label = manage.data?.labels.find((l) => l.id === (current?.answer ? current.answer.labelId : current?.labelId));
  const pressed =
    conversation && subject
      ? {
          accountId: conversation.accountId,
          threadId: conversation.threadId,
          messageIds: conversation.messages.map((m) => m.messageId),
          subject,
          label: label ? { name: label.name, does: label.disposition } : null,
        }
      : null;
  const listed = data && !picked ? messageKey(data) : null;
  useEffect(() => {
    if (listed) onShown(listed);
  }, [listed, onShown]);

  const archive = () => pressed && press([pressed], 'archive', done);
  const spam = () => pressed && press([pressed], 'spam', done);
  const blockSender = () => pressed && data && block([{ ...pressed, from: data.fromAddress }], done);
  const unread = () => pressed && press([pressed], 'unread', onBack);
  const [labelling, setLabelling] = useState(false);
  // In Inbox, as the bar and the foot of the conversation have them, but Label in Mark unread's place: the answer's
  // dropdown as a sheet the thumb reaches. Label and Reply act on the newest, once it has loaded; a digest has neither.
  const thumbs: Thumb[] = threadId
    ? [
        { label: 'Archive', icon: <ArchiveIcon aria-hidden />, disabled: !pressed, onPress: archive },
        ...(data?.digest ? [] : [{ label: 'Label', icon: <TagIcon aria-hidden />, disabled: !data, onPress: () => setLabelling(true) }]),
        ...(compose && !data?.digest
          ? [
              {
                label: 'Reply',
                icon: <ReplyIcon aria-hidden />,
                disabled: !data,
                onPress: () => data && compose({ kind: 'reply', messageId: data.messageId, all: false }),
              },
            ]
          : []),
      ]
    : [];
  const bar = (label?: ReactNode) => (
    <ReaderBar
      label={label}
      back={back}
      onBack={onBack}
      presses={
        threadId
          ? [
              { label: 'Archive', key: 'e', disabled: !pressed, onPress: archive, icon: <ArchiveIcon aria-hidden /> },
              { label: 'Spam', key: '!', disabled: !pressed, onPress: spam, icon: <ShieldAlertIcon aria-hidden /> },
              {
                label: 'Block sender',
                key: 'Shift+b',
                disabled: !pressed || !data || data.digest !== null,
                onPress: blockSender,
                icon: <BanIcon aria-hidden />,
              },
              { label: 'Mark unread', key: 'Shift+u', disabled: !pressed, onPress: unread, icon: <MailIcon aria-hidden /> },
            ]
          : []
      }
      position={items.length > 1 ? `${index + 1} of ${items.length}` : undefined}
      onPrevious={index > 0 ? () => go(index - 1) : undefined}
      onNext={index < items.length - 1 ? () => go(index + 1) : undefined}
    />
  );
  if (loading && fromCopy && conversation)
    return <Arriving conversation={conversation} subject={subject!} bar={bar(<Blank className="h-(--control) w-40 py-0" />)} thumbs={thumbs} />;
  if (loading || (threadId && !conversation && thread.loading))
    return (
      <Reader bar={bar()} thumbs={thumbs} title={picked || item.subject === null ? <Blank /> : reveal(item.subject) || '(no subject)'}>
        <Loading rows={6} />
      </Reader>
    );
  if (!data)
    return (
      <Reader bar={bar()} thumbs={thumbs} title={reveal(item.subject) || '(no subject)'}>
        <Note tone="failure" title="Could not load this message">
          <p>{error}</p>
        </Note>
      </Reader>
    );
  return (
    <>
      <OpenedMessage
        key={`${data.accountId}/${data.messageId}`}
        detail={data}
        conversation={conversation}
        bar={bar}
        thumbs={thumbs}
        onPick={pick}
        onUndone={reload}
        onAnswered={done}
        onRead={() => markRead()}
        labelling={labelling}
        onLabelled={() => setLabelling(false)}
      />
      {blocking ? <RuleDialog labels={manage.data?.labels ?? []} start={standingStart({ address: blocking }, 'blocked')} onClose={stopRuling} /> : null}
    </>
  );
}
