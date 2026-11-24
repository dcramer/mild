'use client';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { ArchiveIcon, BanIcon, MailIcon, ReplyIcon, ShieldAlertIcon, TagIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAnswer, useRecordAnswer, withDoes } from '@/components/answer.tsx';
import { StatusWord, Verdict } from '@/components/bits.tsx';
import { MessageBody, SeenFacts, useMessageView } from '@/components/message-parts.tsx';
import { DigestBody } from '@/components/digest.tsx';
import { useMailPress } from '@/components/mail.tsx';
import { usePlan } from '@/components/model-connect.tsx';
import { ContactHint, SenderFacts, SenderLink, senderHref } from '@/components/sender.tsx';
import { useAction } from '@/lib/action.ts';
import { saveFile, useFiles } from '@/lib/attachments.ts';
import { type Confidential, type MailConversation, type MessageDetail, type RuleMatch, api, changeLoaded, readAhead, useLoaded } from '@/lib/api.ts';
import { conversationOf, conversations, copied, copiedKey } from '@/lib/copy.ts';
import { type Writing, closeReply, useCompose, writing } from '@/lib/compose.ts';
import { capitalised, count, dateTime, money, outcomeName, sureness, tier } from '@/lib/format.ts';
import type { MessageRef } from '@/lib/open-messages.ts';
import { messageKey, useParam } from '@/lib/params.ts';
import { AT_API_PRICES } from '@/lib/prices.ts';
import { reveal } from '@/lib/reveal.ts';
import { type RuleStart, keepStart, messageStart, standingStart } from '@/lib/rule-start.ts';
import { useStarted } from '@/system/started.ts';
import { InlineComposer } from '@/views/composer.tsx';
import { AddLabelsDialog } from '@/views/label-panel.tsx';
import { RuleDialog } from '@/views/rule-dialog.tsx';
import {
  Ago,
  AnswerRow,
  Arrived,
  Blank,
  Button,
  Disclosure,
  Failure,
  Heads,
  Heard,
  LabelSheet,
  Loading,
  MessageHead,
  MessageStack,
  Note,
  Presses,
  Reader,
  ReaderBar,
  Section,
  SomeOf,
  Popover,
  LabelPick,
  Table,
  Td,
  TextLink,
  Th,
  type Thumb,
  Timeline,
  TimelineEvent,
  Tr,
  useToast,
  MessageFiles,
  LabelChip,
} from '@/system';

type Decision = MessageDetail['decisions'][number];
type Action = MessageDetail['actions'][number];

const CHANGE: Record<string, string> = {
  archive: 'Archived',
  spam: 'Marked spam',
  label: 'Labelled',
  undo: 'Undid a change',
  unsubscribe: 'Unsubscribed',
  read: 'Marked read',
  unread: 'Marked unread',
};
/** A change that never landed, as the lists say it ("Not archived"): it is tried again, so it is only history. */
const NOT_DONE: Record<string, string> = {
  archive: 'Not archived',
  spam: 'Not marked spam',
  label: 'Not labelled',
  undo: 'Not undone',
  unsubscribe: 'Not unsubscribed',
  read: 'Not marked read',
  unread: 'Not marked unread',
};

function DecisionEvent({ d }: { d: Decision }) {
  // Through a plan, the call was paid for by it: its cost is only what the API would have charged.
  const plan = usePlan(d.model ?? '');
  const facts = [
    d.ruleId ? `rule ${d.ruleId}` : null,
    d.confidence === null ? null : `confidence ${d.confidence.toFixed(2)}`,
    d.model ? `${d.model}, ${count(d.inputTokens + d.outputTokens)} tokens, ${money(d.costUsd)}${plan ? ` ${AT_API_PRICES}` : ''}` : null,
    d.durationMs === null ? null : `${count(d.durationMs)} ms`,
  ].filter(Boolean);
  return (
    <TimelineEvent
      at={dateTime(d.decidedAt)}
      title={
        <>
          <span className="font-medium">{d.carryOut ? 'Decided' : 'Suggested'}</span>
          <Verdict labelId={d.labelId} labelName={d.labelName} disposition={d.disposition} />
        </>
      }
    >
      <p className="text-foreground">{capitalised(reveal(d.reason))}</p>
      <p>
        By {tier(d.stage).name.toLowerCase()}
        {facts.length > 0 ? ` · ${facts.join(' · ')}` : ''}
      </p>
    </TimelineEvent>
  );
}

/** Where a change got to, when it is not done and did land. */
const ACTION_STATUS: Record<string, string> = { undone: 'Undone', pending: 'Waiting' };

function ActionEvent({ a, onUndo, busy }: { a: Action; onUndo: (id: number) => void; busy: boolean }) {
  const labels = (title: string, list: string[]) =>
    list.length === 0 ? null : (
      <p className="flex flex-wrap items-baseline gap-1.5">
        {title}
        {list.map((label) => (
          <LabelChip key={label}>{label}</LabelChip>
        ))}
      </p>
    );
  return (
    <TimelineEvent
      at={dateTime(a.createdAt)}
      title={
        a.status === 'failed' || a.status === 'unknown' ? (
          <span className="text-muted-foreground">{NOT_DONE[a.type] ?? a.type}</span>
        ) : (
          <>
            <span className="font-medium">{CHANGE[a.type] ?? a.type} in Gmail</span>
            {a.status === 'done' ? null : <span className="text-muted-foreground">{ACTION_STATUS[a.status] ?? a.status}</span>}
          </>
        )
      }
      {...(a.status === 'done' && a.type !== 'undo' && a.type !== 'unsubscribe'
        ? {
            action: (
              <Button busy={busy} onClick={() => onUndo(a.id)}>
                Undo
              </Button>
            ),
          }
        : {})}
    >
      {labels('Added', reveal(a.added))}
      {labels('Removed', reveal(a.removed))}
    </TimelineEvent>
  );
}

/** What happened to a message, oldest first: what Mild decided and what changed in Gmail, each with Undo. */
function History({ detail, onUndone }: { detail: MessageDetail; onUndone: () => void }) {
  const undo = useAction();
  const toast = useToast();
  const history = [
    ...detail.decisions.map((d) => ({ at: d.decidedAt, order: 0, node: <DecisionEvent key={`d${d.id}`} d={d} /> })),
    ...detail.actions.map((a) => ({
      at: a.createdAt,
      order: 1,
      node: (
        <ActionEvent
          key={`a${a.id}`}
          a={a}
          busy={undo.busy}
          onUndo={(id) =>
            undo.run(async () => {
              const { message } = await api.undo(id);
              if (message) toast(message);
              onUndone();
            })
          }
        />
      ),
    })),
  ].toSorted((x, y) => x.at - y.at || x.order - y.order);
  if (history.length === 0) return null;
  return (
    <>
      <Failure>{undo.error}</Failure>
      <Timeline>{history.map((entry) => entry.node)}</Timeline>
    </>
  );
}

const historyCount = (detail: MessageDetail) => detail.decisions.length + detail.actions.length;

/** Each address, the account's own as "me", as a mail app says it. */
const people = (list: MessageDetail['to'], account: string) => list.map((p) => (reveal(p.address) === account ? 'me' : reveal(p.address)));

/**
 * Who a message went to, as To and Cc rows, a long list folded. To the account alone says nothing, unless the person
 * has more than one mailbox: then To always names the one it came to, in full, first where it was not addressed.
 */
function useAddressedTo(detail: MessageDetail): { label: 'To' | 'Cc'; who: ReactNode }[] {
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const own = detail.accountId;
  const to = detail.to.map((p) => reveal(p.address));
  const cc = detail.cc.map((p) => reveal(p.address));
  if ((manage.data?.accounts.length ?? 0) > 1) {
    const named = to.includes(own) || cc.includes(own);
    return [
      { label: 'To' as const, who: <SomeOf items={named ? to : [own, ...to]} /> },
      ...(cc.length > 0 ? [{ label: 'Cc' as const, who: <SomeOf items={cc} /> }] : []),
    ];
  }
  if (cc.length === 0 && to.every((address) => address === own)) return [];
  return [
    ...(to.length > 0 ? [{ label: 'To' as const, who: <SomeOf items={people(detail.to, own)} /> }] : []),
    ...(cc.length > 0 ? [{ label: 'Cc' as const, who: <SomeOf items={people(detail.cc, own)} /> }] : []),
  ];
}

type Answer = Exclude<Writing, { kind: 'new' }>;

/** One message of the conversation, open: who wrote it, to whom and when, with `onAnswer` its own presses for answering it, over its text. */
function Opened({ detail, onAnswer }: { detail: MessageDetail; onAnswer?: ((what: Answer) => void) | undefined }) {
  const address = reveal(detail.fromAddress);
  const name = reveal(detail.fromName);
  const id = detail.messageId;
  const mine = address === detail.accountId;
  const addressedTo = useAddressedTo(detail);
  const view = useMessageView(detail);
  return (
    <>
      <MessageHead
        more={view.more}
        from={
          mine ? (
            'me'
          ) : (
            <>
              <SenderLink address={address} name={name}>
                {name ?? address}
              </SenderLink>
              <ContactHint contact={detail.sender.contact} />
            </>
          )
        }
        {...(name && !mine ? { address: <SenderLink address={address} /> } : {})}
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

/** The message's files, each fetched from Gmail as it is pressed. */
function Files({ detail }: { detail: MessageDetail }) {
  const files = useFiles(detail);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const toast = useToast();
  const save = (part: string) => {
    const file = files.find((f) => f.part === part)!;
    const name = reveal(file.name);
    setSaving((now) => new Set(now).add(part));
    saveFile(detail, part, name)
      .then(
        () => {},
        (error: unknown) => toast(`Could not download ${name}`, { tone: 'failure', description: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() =>
        setSaving((now) => {
          const left = new Set(now);
          left.delete(part);
          return left;
        }),
      );
  };
  return <MessageFiles files={files.map((f) => ({ key: f.part, name: reveal(f.name), size: f.size, saving: saving.has(f.part) }))} onSave={save} />;
}

/** A message of the conversation: the reader's own as it was loaded, any other read as it is first wanted and kept. */
function useMessage(id: string, newest: MessageDetail): { detail: MessageDetail | null; error: string | null } {
  const other = id === newest.messageId ? null : id;
  const loaded = useLoaded(
    `message/${newest.accountId}/${other ?? ''}`,
    (signal) => (other ? api.message(other, signal, newest.accountId) : Promise.resolve(null)),
    30_000,
    '',
  );
  return other ? { detail: loaded.data, error: loaded.error } : { detail: newest, error: null };
}

function OpenOne({ id, newest, onAnswer }: { id: string; newest: MessageDetail; onAnswer?: ((what: Answer) => void) | undefined }) {
  const { detail, error } = useMessage(id, newest);
  if (detail) return <Opened detail={detail} onAnswer={onAnswer} />;
  return error ? <Failure>{error}</Failure> : <Loading rows={4} />;
}

/**
 * The messages of what is open: a conversation (Inbox), oldest first, the reader's own reply included; or one message.
 * Its newest, what is unread and what a reply in the address answers start open, and so does one that arrives while it
 * is (a reply just sent). Opening a conversation with unread mail marks it read. `newest` is the newest in the inbox,
 * which Mild's row is about.
 */
function Messages({
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
  const ids = conversation?.messages.map((m) => m.messageId) ?? [newest.messageId];
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
  const messages = conversation
    ? stacked(conversation)
    : [{ id: newest.messageId, from: reveal(newest.fromName) ?? reveal(newest.fromAddress), preview: null, at: <Arrived at={newest.receivedAt} /> }];
  const toggle = (id: string) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
  };
  return (
    <MessageStack messages={messages} open={open} onToggle={toggle}>
      {(id) => <OpenOne id={id} newest={newest} onAnswer={onAnswer} />}
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
function Arriving({ conversation, subject, bar, thumbs }: { conversation: MailConversation; subject: Confidential; bar: ReactNode; thumbs: readonly Thumb[] }) {
  const messages = stacked(conversation);
  const open = new Set([messages.at(-1)!.id, ...conversation.messages.filter((m) => m.unread).map((m) => m.messageId)]);
  return (
    <Reader bar={bar} thumbs={thumbs} title={reveal(subject) || '(no subject)'}>
      <MessageStack messages={messages} open={open} onToggle={() => {}}>
        {(id) => {
          const m = conversation.messages.find((one) => one.messageId === id)!;
          const address = reveal(m.fromAddress);
          const name = reveal(m.fromName);
          const mine = address === conversation.accountId;
          return (
            <>
              <MessageHead
                from={
                  mine ? (
                    'me'
                  ) : (
                    <SenderLink address={address} name={name}>
                      {name ?? address}
                    </SenderLink>
                  )
                }
                {...(name && !mine ? { address: <SenderLink address={address} /> } : {})}
                at={<Heard at={m.receivedAt} />}
              />
              <Loading rows={2} />
            </>
          );
        }}
      </MessageStack>
    </Reader>
  );
}

/** The reply box, at the foot of the conversation, on the message it answers, which it names when that is not the newest. */
function Answering({ what, newest, onClose }: { what: Answer; newest: MessageDetail; onClose: () => void }) {
  const { detail, error } = useMessage(what.messageId, newest);
  if (!detail) return error ? <Failure>{error}</Failure> : <Loading rows={3} />;
  const who = reveal(detail.fromName) ?? reveal(detail.fromAddress);
  const about =
    detail.messageId === newest.messageId ? undefined : (
      <>
        {what.kind === 'forward' ? `Forwarding ${who}’s message, ` : `Replying to ${who}, `}
        <Arrived at={detail.receivedAt} />
      </>
    );
  return <InlineComposer what={what} message={detail} about={about} onClose={onClose} />;
}

/**
 * Everything about one message once it has loaded. What the message is, which starts on the reader's own answer where
 * they gave one, Why (Mild's reason, and in Inbox the history) and Rule…: in Inbox in the bar, as a mail app's toolbar
 * holds a label, with Why a `Popover`; elsewhere on Mild's row under the title, where answering moves on to the next item.
 * Then the conversation, and what answers it. Opened from anywhere but Inbox, a side column has what Mild saw, the
 * sender, what else of theirs waits, and the history.
 */
function OpenedMessage({
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
  const waiting = useLoaded(`suggestion/${reveal(detail.fromAddress)}`, (signal) => api.suggestion(reveal(detail.fromAddress), signal), 120_000);
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const toast = useToast();
  const compose = useCompose();
  const [composeAs] = useParam('compose');
  const [answering] = useParam('answering');
  const root = useRef<HTMLElement>(null);
  const [adding, setAdding] = useState(false);
  // The rule dialog, opened in place on what this message shows: its sender and label, or one thing Mild saw in it.
  const [ruling, setRuling] = useState<RuleStart | null>(null);
  const current = detail.decisions.at(-1);
  // What the message is, as every list shows it: the user's answer where they gave one, else Mild's.
  const shownLabel = current?.answer ? current.answer.labelId : (current?.labelId ?? null);
  const waitingNow = waiting.data?.messages ?? [];
  const others = waitingNow.filter((m) => m.accountId !== detail.accountId || m.messageId !== detail.messageId);
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
    waitingNow.map((m) => ({
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
            <Button variant="quiet" onClick={() => setRuling(keepStart(reveal(detail.fromAddress), keepable.id))}>
              Keep as {keepable.name}…
            </Button>
          </div>
        ) : null}
        {inInbox ? <History detail={detail} onUndone={onUndone} /> : null}
      </>
    ) : null;
  const ending = { onAdd: () => setAdding(true), onRule: () => setRuling(messageStart(reveal(detail.fromAddress), shownLabel)) };
  // A reply answers the newest in the inbox, or another message of its conversation.
  const answered = conversation?.messages.some((m) => m.messageId === answering) ? answering : detail.messageId;
  const written = compose ? writing(composeAs, answered) : null;
  // A digest is Mild's own: nothing to answer, and no label of its own to say.
  const reply = inInbox && compose && !detail.digest ? compose : undefined;

  return (
    <Reader
      ref={root}
      bar={bar(
        inInbox && !detail.digest ? (
          <>
            <LabelPick
              key={`${current?.id ?? 'undecided'}/${shownLabel ?? ''}`}
              size="toolbar"
              label="What this message is"
              value={shownLabel}
              groups={choices(target, current ? sureness(current) : 1, alternatives)}
              // The reader handles their own mail: the answer is saved and the conversation stays, as the list's does.
              onSubmit={async (id) => {
                await record(target, id);
              }}
              ending={ending}
            />
            {why ? <Popover label="Why">{why}</Popover> : null}
          </>
        ) : undefined,
      )}
      thumbs={written && written.kind !== 'new' ? [] : thumbs}
      title={reveal(detail.subject) || '(no subject)'}
      answer={
        inInbox || detail.digest ? undefined : (
          <AnswerRow
            key={`${current?.id ?? 'undecided'}/${shownLabel ?? ''}`}
            picker={{
              label: 'What this message is',
              value: shownLabel,
              groups: choices(target, current ? sureness(current) : 1, alternatives),
              empty: outcomeName('review'),
              onSubmit: (id) => answer(target, id),
              ending,
            }}
            why={why}
            whyOpen
          />
        )
      }
      side={
        inInbox ? undefined : (
          <>
            <SeenFacts detail={detail} onRule={setRuling} />
            <Section title="Sender" action={<TextLink href={senderHref(reveal(detail.fromAddress))}>All their mail</TextLink>}>
              <SenderFacts profile={detail.sender} />
            </Section>
            {others.length > 0 ? (
              <Section title="Also waiting" meta={count(others.length)}>
                <div className="max-h-56 overflow-y-auto">
                  <Table>
                    <Heads>
                      <Th>Message</Th>
                      <Th num>Received</Th>
                    </Heads>
                    <tbody>
                      {others.map((m) => (
                        <Tr key={`${m.accountId}/${m.messageId}`} onOpen={() => onPick(m)}>
                          <Td className="w-full max-w-0 truncate">{reveal(m.subject) || '(no subject)'}</Td>
                          <Td num quiet>
                            <Ago at={m.receivedAt} />
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Section>
            ) : null}
            {/* After "Also waiting" has loaded, which would otherwise push it down from under the pointer. */}
            {history && !waiting.loading ? (
              <Disclosure summary={`History · ${historyCount(detail)}`}>
                <History detail={detail} onUndone={onUndone} />
              </Disclosure>
            ) : null}
          </>
        )
      }
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
          groups={withDoes(labels, choices(target, current ? sureness(current) : 1, alternatives))}
          onPick={(id) => void Promise.resolve(inInbox ? record(target, id) : answer(target, id)).catch(() => undefined)}
          ending={ending}
        />
      ) : null}
      {adding ? <AddLabelsDialog onClose={() => setAdding(false)} onSaved={() => setAdding(false)} /> : null}
      {ruling ? (
        <RuleDialog
          labels={labels}
          start={ruling}
          onClose={() => setRuling(null)}
          onAdded={(match, rule) => {
            if (rule.whenLabel !== undefined && rule.whenLabel === current?.labelId && rule.disposition === 'keep' && covers(match)) keepThis(rule.whenLabel);
          }}
        />
      ) : null}
    </Reader>
  );
}

/**
 * Every list opens a message here, in the list's place: `items` is the list and `index` the one showing, so previous,
 * next and "answer, then the next one" follow it. `back` names the list, which `onBack` returns to. `onShown` is told
 * which row the message is, for the list to come back to.
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
  // Not narrowed: a message linked to may be in a mailbox the dashboard is not narrowed to.
  const { data, error, loading, reload } = useLoaded(
    `message/${shown.accountId}/${shown.messageId}`,
    (signal) => api.message(shown.messageId, signal, shown.accountId),
    30_000,
    '',
  );
  const threadId = picked ? undefined : item.threadId;
  const threadLoad = `thread/${item.accountId}/${threadId ?? ''}`;
  // A conversation in the inbox is in this browser's copy already (docs/sync.md); the server is asked for one that is not.
  const key = threadId && item.accountId ? copiedKey(item.accountId, threadId) : null;
  const started = useStarted();
  const inCopy = useLiveQuery({ query: (from) => (key && started ? from.from({ c: conversations() }).where(({ c }) => eq(c.key, key)) : undefined) });
  const thread = useLoaded(
    threadLoad,
    (signal) => {
      const held = key ? copied(key) : undefined;
      return held ? Promise.resolve(conversationOf(held)) : threadId ? api.mailThread(threadId, signal, item.accountId) : Promise.resolve(null);
    },
    30_000,
    '',
  );
  // The conversations either side are read ahead, so previous and next wait on nothing.
  useEffect(() => {
    for (const near of [items[index + 1], items[index - 1]])
      if (near?.accountId) readAhead(`message/${near.accountId}/${near.messageId}`, (signal) => api.message(near.messageId, signal, near.accountId));
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
  const next = () => (index < items.length - 1 ? go(index + 1) : onBack());
  const fromCopy = inCopy.data?.[0];
  const conversation = threadId ? (fromCopy ? conversationOf(fromCopy) : thread.data) : null;
  // The copy has all a press needs before the message has loaded.
  const subject = data?.subject ?? fromCopy?.conversation.messages.at(-1)?.subject;
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
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
          thinks: label ? { labelName: label.name, disposition: label.disposition } : null,
        }
      : null;
  const listed = data && !picked ? messageKey(data) : null;
  useEffect(() => {
    if (listed) onShown(listed);
  }, [listed, onShown]);

  const archive = () => pressed && press([pressed], 'archive', next);
  const spam = () => pressed && press([pressed], 'spam', next);
  const blockSender = () => pressed && data && block([{ ...pressed, from: data.fromAddress }], next);
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
      <Reader bar={bar()} thumbs={thumbs} title={<Blank />}>
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
        onAnswered={next}
        onRead={() =>
          changeLoaded<MailConversation | null>(threadLoad, (read) => read && { ...read, messages: read.messages.map((m) => ({ ...m, unread: false })) })
        }
        labelling={labelling}
        onLabelled={() => setLabelling(false)}
      />
      {blocking ? <RuleDialog labels={manage.data?.labels ?? []} start={standingStart({ address: blocking }, 'blocked')} onClose={stopRuling} /> : null}
    </>
  );
}
