'use client';
import { type ReactNode, useEffect, useRef } from 'react';
import { withDoes } from '@/components/answer.tsx';
import { useAnswersBegun } from '@/components/drafts.tsx';
import { StatusWord } from '@/components/bits.tsx';
import { History, historyCount } from '@/components/message-history.tsx';
import type { MailConversation, MessageDetail } from '@/lib/api/endpoints.ts';
import { closeReply, useCompose, writing } from '@/lib/compose.ts';
import { capitalised } from '@/lib/format.ts';
import type { MessageRef } from '@/lib/open-messages.ts';
import { useParam } from '@/lib/params.ts';
import { reveal } from '@/lib/reveal.ts';
import { keepStart } from '@/lib/rule-start.ts';
import { outcomeName } from '@/lib/words.ts';
import { AnswerPicker, Button, LabelPick, LabelSheet, Popover, Presses, Reader, type Thumb } from '@/system';
import { Messages } from './messages.tsx';
import { Answering } from './reply.tsx';
import { MessageSide } from './side.tsx';
import { useWhatItIs } from './what-it-is.ts';

/**
 * Everything about one message once it has loaded. What the message is, which starts on the reader's own answer where
 * they gave one, Why (Mild's reason, and in Inbox the history) and Rule…: in Inbox in the bar, as a mail app's toolbar
 * holds a label, with Why a `Popover`; elsewhere on Mild's row under the title, where answering returns to the list.
 * Then the conversation, and what answers it. Opened from anywhere but Inbox, a side column has what Mild saw, the
 * sender, what else of theirs waits, and the history.
 */
export function OpenedMessage({
  detail,
  conversation,
  bar,
  thumbs,
  onPick,
  onAnswered,
  onUndone,
  onRead,
  labelling,
  onLabelled,
}: {
  detail: MessageDetail;
  conversation: MailConversation | null;
  /** The bar, given what the message is where Inbox puts it there. */
  bar: (label?: ReactNode) => ReactNode;
  /** The presses at the bottom of a phone's screen, put away while the reply box is open. */
  thumbs: readonly Thumb[];
  /** Show another message from the same sender here. */
  onPick: (message: Pick<MessageRef, 'accountId' | 'messageId'>) => void;
  onAnswered: () => void;
  onUndone: () => void;
  /** The conversation was marked read. */
  onRead: () => void;
  /** Its phone press Label was pressed: what the message is, from a `LabelSheet`, until `onLabelled`. */
  labelling: boolean;
  onLabelled: () => void;
}) {
  const { current, shownLabel, labels, waiting, groups, record, answer, keepable, ending, openRule, dialogs } = useWhatItIs(detail, onAnswered);
  const compose = useCompose();
  const [composeAs] = useParam('compose');
  const [answering] = useParam('answering');
  const root = useRef<HTMLElement>(null);

  // Inbox reads mail; everywhere else the job is what Mild said, so what it said about the message sits beside it.
  const inInbox = conversation !== null;
  const history = historyCount(detail) > 0;
  const said = current ? (
    <p>
      {current.answer ? 'Your answer. Mild said: ' : null}
      {current.answer ? reveal(current.reason) : capitalised(reveal(current.reason))}
      {current.carryOut ? (
        <>
          {' · '}
          <StatusWord row={current} />
        </>
      ) : null}
    </p>
  ) : null;
  const why =
    said || keepable || (inInbox && history) ? (
      <>
        {said}
        {keepable ? (
          <div className="-ml-3">
            <Button variant="quiet" onClick={() => openRule(keepStart(reveal(detail.fromAddress), keepable.id))}>
              Keep as {keepable.name}…
            </Button>
          </div>
        ) : null}
        {inInbox ? <History detail={detail} onUndone={onUndone} /> : null}
      </>
    ) : null;
  // A reply answers the newest in the inbox, or another message of its conversation.
  const answered = conversation?.messages.some((m) => m.messageId === answering) ? answering : detail.messageId;
  const written = compose ? writing(composeAs, answered) : null;
  // A digest is Mild's own: nothing to answer, and no label of its own to say.
  const reply = inInbox && compose && !detail.digest ? compose : undefined;
  // Opened on an answer begun to any of its messages, as Gmail opens a conversation on its draft: once, as it opens.
  const begun = useAnswersBegun();
  const looked = useRef(false);
  const ids = conversation?.messages.map((m) => m.messageId);
  useEffect(() => {
    if (looked.current || !reply || !ids || !begun) return;
    looked.current = true;
    const draft = composeAs ? undefined : ids.toReversed().find((id) => begun.has(id));
    if (draft) reply(begun.get(draft));
  }, [begun, reply, ids, composeAs]);

  return (
    <Reader
      ref={root}
      bar={bar(
        detail.digest ? undefined : (
          <>
            {inInbox ? (
              <LabelPick
                key={`${current?.id ?? 'undecided'}/${shownLabel ?? ''}`}
                size="toolbar"
                label="What this message is"
                value={shownLabel}
                groups={groups}
                // The reader handles their own mail: the answer is saved and the conversation stays, as the list's does.
                onSubmit={async (id) => {
                  await record(id);
                }}
                ending={ending}
              />
            ) : (
              <AnswerPicker
                key={`${current?.id ?? 'undecided'}/${shownLabel ?? ''}`}
                size="toolbar"
                className="min-w-0"
                label="What this message is"
                value={shownLabel}
                groups={groups}
                empty={outcomeName('review')}
                onSubmit={answer}
                ending={ending}
              />
            )}
            {why ? <Popover label="Why">{why}</Popover> : null}
          </>
        ),
      )}
      thumbs={written && written.kind !== 'new' ? [] : thumbs}
      title={reveal(detail.subject) || '(no subject)'}
      side={inInbox ? undefined : <MessageSide detail={detail} waiting={waiting} onRule={openRule} onPick={onPick} onUndone={onUndone} />}
    >
      <Messages conversation={conversation} newest={detail} answered={written && written.kind !== 'new' ? answered : null} onAnswer={reply} onRead={onRead} />
      {written && written.kind !== 'new' ? (
        <Answering
          key={`${composeAs}/${answered}`}
          what={written}
          newest={detail}
          onClose={() => {
            closeReply();
            root.current?.focus({ preventScroll: true });
          }}
        />
      ) : reply ? (
        // On a phone Reply is at the bottom of the screen, and Reply all and Forward in each message's ⋮.
        <div className="phone:hidden">
          <Presses
            presses={[
              { label: 'Reply', key: 'r', onPress: () => reply({ kind: 'reply', messageId: detail.messageId, all: false }) },
              { label: 'Reply all', key: 'a', onPress: () => reply({ kind: 'reply', messageId: detail.messageId, all: true }) },
              { label: 'Forward', key: 'f', onPress: () => reply({ kind: 'forward', messageId: detail.messageId }) },
            ]}
          />
        </div>
      ) : null}
      {labelling && !detail.digest ? (
        <LabelSheet
          open
          onClose={onLabelled}
          who={reveal(detail.fromName) ?? reveal(detail.fromAddress)}
          subject={reveal(detail.subject) || '(no subject)'}
          value={shownLabel}
          groups={withDoes(labels, groups)}
          onPick={(id) => void Promise.resolve(inInbox ? record(id) : answer(id)).catch(() => undefined)}
          ending={ending}
        />
      ) : null}
      {dialogs}
    </Reader>
  );
}
