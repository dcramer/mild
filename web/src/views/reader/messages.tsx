'use client';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { DigestBody } from '@/components/digest.tsx';
import { useMailPress } from '@/components/mail.tsx';
import { Letter, MessageBody, useMessageView } from '@/components/message-parts.tsx';
import type { Confidential, MailConversation, MessageDetail } from '@/lib/api/endpoints.ts';
import { reveal } from '@/lib/reveal.ts';
import { type Sending, stopSending, useSending } from '@/lib/sending.ts';
import { Arrived, Failure, Heard, Loading, MessageStack, Reader, type Thumb } from '@/system';
import { useConversationMessage } from './conversation.ts';
import { Files } from './files.tsx';
import { SenderHead, useAddressed, useAddressedTo } from './head.tsx';
import type { Answer } from './reply.tsx';

/** One message of the conversation, open: who wrote it, to whom and when, with `onAnswer` its own presses for answering it, over its text. */
function Opened({ detail, onAnswer }: { detail: MessageDetail; onAnswer?: ((what: Answer) => void) | undefined }) {
  const address = reveal(detail.fromAddress);
  const id = detail.messageId;
  const addressedTo = useAddressedTo(detail);
  const view = useMessageView(detail);
  return (
    <>
      <SenderHead
        more={view.more}
        address={address}
        name={reveal(detail.fromName)}
        mine={address === detail.accountId}
        contact={detail.sender.contact}
        at={<Heard at={detail.receivedAt} />}
        to={addressedTo}
        {...(onAnswer
          ? {
              answers: {
                reply: () => onAnswer({ kind: 'reply', messageId: id, all: false }),
                all: () => onAnswer({ kind: 'reply', messageId: id, all: true }),
                forward: () => onAnswer({ kind: 'forward', messageId: id }),
              },
            }
          : {})}
      />
      {detail.digest ? (
        <DigestBody digest={detail.digest} />
      ) : (
        <>
          <MessageBody key={id} detail={detail} view={view} />
          <Files detail={detail} />
        </>
      )}
    </>
  );
}

/** A reply on its way, drawn as it will be once Gmail has it, but "Sending…" for when. */
function OnItsWay({ sending, account }: { sending: Sending; account: string }) {
  const to = useAddressed(
    account,
    sending.to.map((p) => p.address),
    sending.cc.map((p) => p.address),
    true,
  );
  return (
    <>
      <SenderHead address={sending.from} name={null} mine at={<span>Sending…</span>} to={to} />
      <Letter text={sending.text} />
    </>
  );
}

function OpenOne({
  id,
  newest,
  sending,
  onAnswer,
}: {
  id: string;
  newest: MessageDetail;
  /** The reply this is Gmail's copy of, drawn until that has loaded. */
  sending: Sending | undefined;
  onAnswer?: ((what: Answer) => void) | undefined;
}) {
  const { detail, error } = useConversationMessage(id, newest);
  const draft = sending?.draft;
  useEffect(() => {
    if (detail && draft) stopSending(draft);
  }, [detail, draft]);
  if (detail) return <Opened detail={detail} onAnswer={onAnswer} />;
  if (sending) return <OnItsWay sending={sending} account={newest.accountId} />;
  return error ? <Failure>{error}</Failure> : <Loading rows={4} />;
}

const SENDING = 'sending/';

/**
 * The messages of what is open: a conversation (Inbox), oldest first, the reader's own reply included; or one message.
 * Its newest, what is unread and what a reply in the address answers start open, and so does one that arrives while it
 * is (a reply just sent). Opening a conversation with unread mail marks it read. `newest` is the newest in the inbox,
 * which Mild's row is about.
 */
export function Messages({
  conversation,
  newest,
  answered,
  onAnswer,
  onRead,
}: {
  conversation: MailConversation | null;
  newest: MessageDetail;
  answered: string | null;
  onAnswer?: ((what: Answer) => void) | undefined;
  onRead: () => void;
}) {
  const listed = conversation?.messages.map((m) => m.messageId) ?? [newest.messageId];
  // Replies on their way to this conversation that it does not have yet.
  const all = useSending();
  const sending = all.filter((s) => listed.includes(s.answers) && !(s.sent && listed.includes(s.sent)));
  const ids = [...listed, ...sending.map((s) => SENDING + s.draft)];
  const unread = conversation?.messages.filter((m) => m.unread).map((m) => m.messageId) ?? [];
  const [open, setOpen] = useState(() => new Set([ids.at(-1) ?? newest.messageId, ...unread, ...(answered ? [answered] : [])]));
  const [known, setKnown] = useState(ids);
  const arrived = ids.filter((id) => !known.includes(id));
  if (arrived.length > 0) {
    setKnown(ids);
    setOpen(new Set([...open, ...arrived]));
  }
  const { press } = useMailPress();
  // Read is a change in Gmail like any other, made once as it opens.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || !conversation || unread.length === 0) return;
    marked.current = true;
    press([{ accountId: conversation.accountId, threadId: conversation.threadId, messageIds: unread, subject: newest.subject }], 'read');
    onRead();
  });
  const messages = [
    ...(conversation
      ? stacked(conversation)
      : [{ id: newest.messageId, from: reveal(newest.fromName) ?? reveal(newest.fromAddress), preview: null, at: <Arrived at={newest.receivedAt} /> }]),
    ...sending.map((s) => ({ id: SENDING + s.draft, from: 'me', preview: s.text, at: 'Sending…' })),
  ];
  const toggle = (id: string) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
  };
  return (
    <MessageStack messages={messages} open={open} onToggle={toggle}>
      {(id) => {
        const on = sending.find((s) => SENDING + s.draft === id);
        if (on) return <OnItsWay sending={on} account={newest.accountId} />;
        return <OpenOne id={id} newest={newest} sending={all.find((s) => s.sent === id)} onAnswer={onAnswer} />;
      }}
    </MessageStack>
  );
}

/** A conversation's messages as the stack draws them, folded or open. */
const stacked = (conversation: MailConversation) =>
  conversation.messages.map((m) => ({
    id: m.messageId,
    from: reveal(m.fromAddress) === conversation.accountId ? 'me' : (reveal(m.fromName) ?? reveal(m.fromAddress)),
    preview: m.preview ? reveal(m.preview) : null,
    at: <Heard at={m.receivedAt} />,
    unread: m.unread,
  }));

/**
 * A conversation the copy holds, drawn while its newest message loads: its subject, a place for Mild's row, and its
 * messages, the newest and the unread open on their text to come, as the conversation draws once it has.
 */
export function Arriving({
  conversation,
  subject,
  bar,
  thumbs,
}: {
  conversation: MailConversation;
  subject: Confidential;
  bar: ReactNode;
  thumbs: readonly Thumb[];
}) {
  const messages = stacked(conversation);
  const open = new Set([messages.at(-1)!.id, ...conversation.messages.filter((m) => m.unread).map((m) => m.messageId)]);
  return (
    <Reader bar={bar} thumbs={thumbs} title={reveal(subject) || '(no subject)'}>
      <MessageStack messages={messages} open={open} onToggle={() => {}}>
        {(id) => {
          const m = conversation.messages.find((one) => one.messageId === id)!;
          const address = reveal(m.fromAddress);
          return (
            <>
              <SenderHead address={address} name={reveal(m.fromName)} mine={address === conversation.accountId} at={<Heard at={m.receivedAt} />} />
              <Loading rows={2} />
            </>
          );
        }}
      </MessageStack>
    </Reader>
  );
}
