'use client';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAction } from '@/lib/action.ts';
import { type Party, type Recipient, readAddresses, typed, wrongAddresses } from '@/lib/addresses.ts';
import { api, useLoaded } from '@/lib/api.ts';
import { dateTime } from '@/lib/format.ts';
import { type Draft, type Writing, emptyDraft, keepDraft, keptDraft, newMessageId, useCompose } from '@/lib/compose.ts';
import { uploadFile } from '@/lib/upload.ts';
import { useChosenMailbox } from '@/lib/mailbox.ts';
import { useHere } from '@/lib/params.ts';
import { reveal } from '@/lib/reveal.ts';
import {
  AttachButton,
  Button,
  DiscardButton,
  DraftBlocked,
  type DraftFile,
  DraftFiles,
  DraftLine,
  DraftText,
  Failure,
  Finish,
  Input,
  Loading,
  Panel,
  Recipients,
  ReplyBox,
  withTyped,
  Select,
  useToast,
} from '@/system';
import type { ManageState, MessageAttachment, MessageDetail } from '../../../src/dashboard/types.ts';

/** An address mail can be from: a mailbox's own, or one of its aliases, and whether Google lets Mild send from that mailbox. */
interface From {
  address: string;
  accountId: string;
  canSend: boolean;
}

const addressesOf = (account: ManageState['accounts'][number]): From[] =>
  [account.email, ...account.aliases].map((address) => ({ address, accountId: account.id, canSend: account.canSend }));

/** "Re: " once, as Gmail and the server put it. */
const answering = (subject: string) => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`);
/** "Fwd: " once. */
const forwarding = (subject: string) => (/^fwd?:/i.test(subject.trim()) ? subject.trim() : `Fwd: ${subject.trim()}`);

const TITLES = { new: 'New message', reply: 'Reply', all: 'Reply to all', forward: 'Forward' } as const;

/**
 * A new message, in a narrow panel over whatever is open: From (when there is more than one address to send as), To, Cc
 * on a press, a subject and the text. What is written is kept in this browser until it is sent or discarded, so closing
 * it, or a reload, loses nothing.
 */
/** A new message, in a panel of its own; `to` someone already, from their page. */
export function Composer({ to, onClose }: { to: string; onClose: () => void }) {
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000, '');
  const accounts = manage.data?.accounts ?? [];
  const chosen = useChosenMailbox(accounts.map((a) => a.email));
  // Every address that may send, and the one it starts on even if it may not yet, so the composer can say so.
  const start = accounts.find((a) => a.id === chosen) ?? accounts.find((a) => a.primary && a.canSend) ?? accounts.find((a) => a.canSend) ?? accounts[0];
  if (!start)
    return (
      <Panel narrow open onClose={onClose} title={TITLES.new}>
        <Loading />
      </Panel>
    );
  return (
    <Writer
      what={to ? { kind: 'new', to } : { kind: 'new' }}
      title={TITLES.new}
      choices={accounts.filter((a) => a.canSend || a === start).flatMap(addressesOf)}
      start={emptyDraft(start.email, { to: readAddresses(to).parties })}
      onClose={onClose}
    />
  );
}

/**
 * A reply or a forward of `message`, written in the reader at the foot of its conversation, from the mailbox it came to,
 * by the address it was sent to; `about` names the message when it is not the newest. A reply goes to whoever replies go
 * to; a forward to whoever the reader types, with the message quoted under their text. Kept in this browser as a new
 * message is.
 */
export function InlineComposer({
  what,
  message,
  about,
  onClose,
}: {
  what: Exclude<Writing, { kind: 'new' }>;
  message: MessageDetail;
  about?: ReactNode;
  onClose: () => void;
}) {
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000, '');
  const account = manage.data?.accounts.find((a) => a.id === message.accountId);
  if (!account) return <Loading rows={3} />;
  const choices = addressesOf(account);
  return (
    <Writer
      inline
      about={about}
      what={what}
      title={TITLES[what.kind === 'reply' && what.all ? 'all' : what.kind]}
      {...(what.kind === 'reply' ? { subject: answering(reveal(message.subject)) } : {})}
      choices={choices}
      start={what.kind === 'reply' ? replyDraft(message, choices, what.all) : forwardDraft(message, choices)}
      {...(what.kind === 'forward' ? { forwarded: message } : {})}
      onClose={onClose}
    />
  );
}

const shown = (list: MessageDetail['to']): Party[] => list.map((p) => ({ address: reveal(p.address), ...(p.name ? { name: reveal(p.name) } : {}) }));
const senderOf = (message: MessageDetail): Party => ({ address: reveal(message.fromAddress), ...(message.fromName ? { name: reveal(message.fromName) } : {}) });
const owns = (choices: readonly From[]) => {
  const own = new Set(choices.map((c) => c.address.toLowerCase()));
  return (p: Party) => own.has(p.address.toLowerCase());
};
/** The address the message was sent to, of those it can be answered from. */
const answeredFrom = (message: MessageDetail, choices: readonly From[]) =>
  [...shown(message.to), ...shown(message.cc)].find(owns(choices))?.address ?? choices[0].address;

function replyDraft(message: MessageDetail, choices: readonly From[], all: boolean): Draft {
  const isOwn = owns(choices);
  const sender = senderOf(message);
  const asked = message.headers['reply-to'] ? readAddresses(reveal(message.headers['reply-to'])).parties : [];
  const recipients = [...shown(message.to), ...shown(message.cc)];
  // Mail the person sent themselves is answered as Gmail does: to whoever it went to.
  const to = isOwn(sender) ? shown(message.to).filter((p) => !isOwn(p)) : asked.length > 0 ? asked : [sender];
  const answered = new Set(to.map((p) => p.address.toLowerCase()));
  const cc = all ? recipients.filter((p) => !isOwn(p) && !answered.has(p.address.toLowerCase())) : [];
  return emptyDraft(answeredFrom(message, choices), { to, cc, showCc: cc.length > 0 });
}

/** Gmail's quote of a forwarded message, under two empty lines for the reader's own text. Its files go with it (`ForwardedFiles`). */
function forwardDraft(message: MessageDetail, choices: readonly From[]): Draft {
  const subject = reveal(message.subject);
  const quoted = [
    '---------- Forwarded message ---------',
    `From: ${typed(senderOf(message))}`,
    `Date: ${dateTime(message.receivedAt)}`,
    `Subject: ${subject}`,
    ...(message.to.length > 0 ? [`To: ${shown(message.to).map(typed).join(', ')}`] : []),
    ...(message.cc.length > 0 ? [`Cc: ${shown(message.cc).map(typed).join(', ')}`] : []),
    '',
    reveal(message.body) ?? '',
  ];
  return emptyDraft(answeredFrom(message, choices), { subject: forwarding(subject), text: `\n\n${quoted.join('\n')}` });
}

/** Whom to suggest as an address is typed: the person's own address book, on the server. */
const suggest = async (q: string, signal: AbortSignal): Promise<Party[]> =>
  (await api.addresses(q, signal)).addresses.map((a) => ({ address: reveal(a.address), ...(a.name ? { name: reveal(a.name) } : {}) }));

/** What is wrong with a line's recipients, in a sentence, or null. */
const wrongOf = (list: readonly Recipient[]) => wrongAddresses(list.filter((r) => r.wrong).map((r) => r.address));

/** Files being uploaded, by a key of their own until Mild gives them an id. */
interface Uploading {
  key: string;
  file: File;
  added: number;
  sent: number;
  failed?: string;
  abort: AbortController;
}

/** The forwarded message's files, as the record has them; read from Gmail once where it does not. */
function useForwarded(message: MessageDetail | undefined): MessageAttachment[] {
  const [read, setRead] = useState<MessageAttachment[] | null>(null);
  const kept = message?.attachments ?? null;
  const unknown = message !== undefined && kept === null;
  useEffect(() => {
    if (!unknown) return;
    let current = true;
    api.attachments(message.accountId, message.messageId).then(
      (r) => current && setRead(r.attachments),
      () => current && setRead([]),
    );
    return () => {
      current = false;
    };
  }, [unknown, message?.accountId, message?.messageId]);
  return kept ?? read ?? [];
}

/** The composer's fields, text and presses: in a panel of their own for new mail, in place under the conversation (`inline`) for a reply or a forward. */
function Writer({
  what,
  title,
  subject,
  choices,
  start,
  forwarded,
  inline = false,
  about,
  onClose,
}: {
  what: Writing;
  title: string;
  /** A reply's, which the server sets. */
  subject?: string;
  choices: readonly From[];
  start: Draft;
  /** The message a forward carries the files of. */
  forwarded?: MessageDetail;
  inline?: boolean;
  about?: ReactNode;
  onClose: () => void;
}) {
  const who = useLoaded('session', (signal) => api.session(signal), 300_000, '').data?.email ?? '';
  const [draft, setDraft] = useState(() => keptDraft(who, what) ?? start);
  const change = (next: Partial<Draft> | ((was: Draft) => Partial<Draft>)) => {
    setDraft((was) => {
      const asked = typeof next === 'function' ? next(was) : next;
      // A changed draft is mail of its own: a try before the change may have gone, and must not be found and called this one.
      const changed = { ...was, ...('id' in asked ? {} : { id: null }), ...asked };
      keepDraft(who, what, changed);
      return changed;
    });
  };
  const [uploading, setUploading] = useState<Uploading[]>([]);
  // What is typed in each line that is not a chip yet.
  const [typing, setTyping] = useState({ to: '', cc: '', bcc: '' });
  const files = useForwarded(forwarded);
  const carried = files.filter((f) => !draft.dropped.includes(f.part));
  const toField = useRef<HTMLInputElement>(null);
  // Cc or Bcc asked for: entered once it is drawn.
  const asked = useRef<'cc' | 'bcc' | null>(null);
  // One for each line, made once: a ref that changed each render would be attached again each render.
  const [entered] = useState(() => {
    const enter = (line: 'cc' | 'bcc') => (field: HTMLInputElement | null) => {
      if (field && asked.current === line) {
        field.focus();
        asked.current = null;
      }
    };
    return { cc: enter('cc'), bcc: enter('bcc') };
  });
  const textField = useRef<HTMLTextAreaElement>(null);
  // A forward's text starts with the quote; the reader writes above it.
  useEffect(() => {
    if (what.kind === 'forward') textField.current?.setSelectionRange(0, 0);
  }, [what.kind]);
  // A panel is given where to start; in place, it starts there as it opens, below the conversation it answers.
  const first = what.kind !== 'reply' && draft.to.length === 0 ? toField : textField;
  const [opening] = useState(() => (inline ? first : null));
  useEffect(() => opening?.current?.focus(), [opening]);
  const toast = useToast();
  const compose = useCompose();
  const here = useHere();
  const { busy, error, run } = useAction();

  const from = choices.find((c) => c.address === draft.from) ?? choices[0];
  const addressee = draft.to[0] ?? draft.cc[0] ?? draft.bcc[0] ?? withTyped([], typing.to)[0];
  // What a toast calls it: its subject, or who it is to.
  const said = (subject ?? draft.subject.trim()) || (addressee ? `To ${typed(addressee)}` : title);

  const attach = (picked: readonly File[]) => {
    for (const [index, file] of picked.entries()) {
      const key = crypto.randomUUID();
      const added = Date.now() + index;
      const abort = new AbortController();
      const set = (more: Partial<Uploading>) => setUploading((all) => all.map((u) => (u.key === key ? { ...u, ...more } : u)));
      setUploading((all) => [...all, { key, file, added, sent: 0, abort }]);
      uploadFile(file, (sent) => set({ sent }), abort.signal).then(
        (id) => {
          // Taken off as it finished: Mild need not keep it.
          if (abort.signal.aborted) {
            api.removeUpload(id).catch(() => {});
            return;
          }
          setUploading((all) => all.filter((u) => u.key !== key));
          change((was) => ({ files: [...was.files, { id, name: file.name, size: file.size, added }] }));
        },
        (failure: unknown) => {
          if (!abort.signal.aborted) set({ failed: failure instanceof Error ? failure.message : 'It did not upload.' });
        },
      );
    }
  };
  const detach = (key: string) => {
    const going = uploading.find((u) => u.key === key);
    if (going) {
      going.abort.abort();
      setUploading((all) => all.filter((u) => u.key !== key));
      return;
    }
    if (files.some((f) => f.part === key)) {
      change((was) => ({ dropped: [...was.dropped, key] }));
      return;
    }
    change((was) => ({ files: was.files.filter((f) => f.id !== key) }));
    api.removeUpload(key).catch(() => {});
  };
  const shownFiles: DraftFile[] = [
    ...carried.map((f) => ({ key: f.part, name: reveal(f.name), size: f.size })),
    ...[
      ...draft.files.map((f) => ({ added: f.added, file: { key: f.id, name: f.name, size: f.size } })),
      ...uploading.map((u) => ({
        added: u.added,
        file: { key: u.key, name: u.file.name, size: u.file.size, sent: u.sent, ...(u.failed ? { failed: u.failed } : {}) },
      })),
    ]
      .toSorted((a, b) => a.added - b.added)
      .map((f) => f.file),
  ];

  const everyone = [...draft.to, ...draft.cc, ...draft.bcc];
  const nobody = everyone.length === 0 && Object.values(typing).every((t) => t.trim() === '');
  const wrong = everyone.some((r) => r.wrong);
  const waiting = uploading.length > 0;
  const send = () => {
    if (!from.canSend || nobody || wrong || waiting) return;
    // What is still being typed goes as it would once the line is left.
    const lines = { to: withTyped(draft.to, typing.to), cc: withTyped(draft.cc, typing.cc), bcc: withTyped(draft.bcc, typing.bcc) };
    setTyping({ to: '', cc: '', bcc: '' });
    if ([...lines.to, ...lines.cc, ...lines.bcc].some((r) => r.wrong)) {
      change(lines);
      return;
    }
    const id = draft.id ?? newMessageId(from.address);
    change({ ...lines, id });
    const parties = (list: readonly Recipient[]) => list.map(({ address, name }) => (name ? { address, name } : { address }));
    const mail = {
      accountId: from.accountId,
      id,
      from: { address: from.address },
      to: parties(lines.to),
      cc: parties(lines.cc),
      bcc: parties(lines.bcc),
      text: draft.text,
      uploads: draft.files.map((f) => f.id),
    };
    run(
      () =>
        api.send(
          what.kind === 'reply'
            ? { ...mail, replyTo: { messageId: what.messageId } }
            : {
                ...mail,
                subject: draft.subject,
                ...(what.kind === 'forward' && carried.length > 0 ? { forwarding: { messageId: what.messageId, parts: carried.map((f) => f.part) } } : {}),
              },
        ),
      () => {
        keepDraft(who, what, null);
        toast(said, { kind: 'Sent' });
        onClose();
      },
    );
  };
  const discard = () => {
    for (const u of uploading) u.abort.abort();
    keepDraft(who, what, null);
    toast(said, {
      kind: 'Draft discarded',
      undo: () => {
        keepDraft(who, what, draft);
        compose?.(what);
      },
    });
    onClose();
  };

  const fromLine =
    choices.length > 1 ? (
      <DraftLine label="From">
        <Select
          label="From"
          value={from.address}
          options={choices.map((c) => [c.address, c.address] as const)}
          onChange={(address) => change({ from: address })}
        />
      </DraftLine>
    ) : null;

  // Nothing to write in until Google lets Mild send from this mailbox: only the press that asks, and any other address to send from.
  if (!from.canSend) {
    const allow = (
      <Button variant="mark" href={`/auth/login?${new URLSearchParams({ grant: 'send', mailbox: from.accountId, to: here })}`}>
        Let Mild send
      </Button>
    );
    const blocked = <DraftBlocked title={`Mild can’t send from ${from.accountId} yet`}>Google asks you once before Mild can send as you.</DraftBlocked>;
    if (inline)
      return (
        <ReplyBox
          label={title}
          about={about}
          actions={
            <>
              {allow}
              <Button variant="quiet" onClick={onClose}>
                Not now
              </Button>
            </>
          }
        >
          {blocked}
        </ReplyBox>
      );
    return (
      <Panel narrow open onClose={onClose} title={title} actions={allow}>
        {fromLine}
        {blocked}
      </Panel>
    );
  }

  const actions = (
    <>
      <Finish
        busy={busy}
        disabled={nobody || wrong || waiting}
        {...(nobody ? { why: 'Say who it is to.' } : wrong ? { why: 'An address is wrong.' } : waiting ? { why: 'A file is still uploading.' } : {})}
        onClick={send}
      >
        Send
      </Finish>
      <AttachButton onFiles={attach} />
      <Failure>{error}</Failure>
      <DiscardButton onClick={discard} />
    </>
  );

  const lineFor = (line: 'cc' | 'bcc') => (
    <DraftLine label={line === 'cc' ? 'Cc' : 'Bcc'} error={wrongOf(draft[line])}>
      <Recipients
        label={line === 'cc' ? 'Cc' : 'Bcc'}
        value={draft[line]}
        onChange={(next) => change({ [line]: next })}
        text={typing[line]}
        onText={(text) => setTyping((was) => ({ ...was, [line]: text }))}
        suggest={suggest}
        inputRef={entered[line]}
      />
    </DraftLine>
  );
  const ask = (line: 'cc' | 'bcc') => (
    <Button
      variant="quiet"
      onClick={() => {
        asked.current = line;
        change(line === 'cc' ? { showCc: true } : { showBcc: true });
      }}
    >
      {line === 'cc' ? 'Cc' : 'Bcc'}
    </Button>
  );

  // Not a Form: Enter in To or Subject must not send.
  const fields = (
    <div
      className="contents"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        attach([...event.dataTransfer.files]);
      }}
    >
      {fromLine}
      <DraftLine label="To" error={wrongOf(draft.to)}>
        <Recipients
          label="To"
          value={draft.to}
          onChange={(to) => change({ to })}
          text={typing.to}
          onText={(to) => setTyping((was) => ({ ...was, to }))}
          suggest={suggest}
          inputRef={toField}
        />
        {draft.showCc ? null : ask('cc')}
        {draft.showBcc ? null : ask('bcc')}
      </DraftLine>
      {draft.showCc ? lineFor('cc') : null}
      {draft.showBcc ? lineFor('bcc') : null}
      {what.kind === 'reply' ? null : (
        <DraftLine label="Subject">
          <Input bare aria-label="Subject" className="flex-1" value={draft.subject} onChange={(event) => change({ subject: event.target.value })} />
        </DraftLine>
      )}
      <DraftText
        ref={textField}
        aria-label="Message"
        className={inline ? 'min-h-48' : 'min-h-72'}
        value={draft.text}
        onChange={(event) => change({ text: event.target.value })}
      />
      <DraftFiles files={shownFiles} onRemove={detach} />
    </div>
  );
  if (inline)
    return (
      <ReplyBox label={title} about={about} actions={actions}>
        {fields}
      </ReplyBox>
    );
  return (
    <Panel narrow open onClose={onClose} title={title} actions={actions} focus={first}>
      {fields}
    </Panel>
  );
}
