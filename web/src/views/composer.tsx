'use client';
import { useEffect, useRef, useState } from 'react';
import { useAction } from '@/lib/action.ts';
import { type Party, readAddresses, typed, wrongAddresses } from '@/lib/addresses.ts';
import { api, useLoaded } from '@/lib/api.ts';
import { dateTime } from '@/lib/format.ts';
import { type Draft, type Writing, keepDraft, keptDraft, newMessageId, useCompose } from '@/lib/compose.ts';
import { useChosenMailbox } from '@/lib/mailbox.ts';
import { useHere } from '@/lib/params.ts';
import { reveal } from '@/lib/reveal.ts';
import { Button, Failure, Field, Finish, Input, Loading, Note, Panel, Select, TextArea, useToast } from '@/system';
import type { ManageState, MessageDetail } from '../../../src/dashboard/types.ts';

/** An address mail can be from: a mailbox's own, or one of its aliases, and whether Google lets Sift send from that mailbox. */
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
 * Writing mail, in a narrow panel over whatever is open: a new message, or a reply to one, which the address names. From
 * (when there is more than one address to send as), To, Cc on a press, a subject for new mail, and the text. What is
 * written is kept in this browser until it is sent or discarded, so closing it, or a reload, loses nothing.
 */
export function Composer({ what, onClose }: { what: Writing; onClose: () => void }) {
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000, '');
  const accounts = manage.data?.accounts ?? [];
  const chosen = useChosenMailbox(accounts.map((a) => a.email));
  const title = TITLES[what.kind === 'reply' && what.all ? 'all' : what.kind];
  if (!manage.data) return <Waiting title={title} onClose={onClose} />;
  if (what.kind !== 'new') return <FromMessage what={what} title={title} accounts={accounts} onClose={onClose} />;

  // Every address that may send, and the one it starts on even if it may not yet, so the composer can say so.
  const start = accounts.find((a) => a.id === chosen) ?? accounts.find((a) => a.primary && a.canSend) ?? accounts.find((a) => a.canSend) ?? accounts[0];
  if (!start) return <Waiting title={title} onClose={onClose} />;
  const choices = accounts.filter((a) => a.canSend || a === start).flatMap(addressesOf);
  return (
    <Writer
      what={what}
      title={title}
      choices={choices}
      start={{ from: start.email, to: '', cc: '', showCc: false, subject: '', text: '', id: null }}
      onClose={onClose}
    />
  );
}

function Waiting({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Panel narrow open onClose={onClose} title={title}>
      <Loading />
    </Panel>
  );
}

/**
 * A reply or a forward starts from the message, from the mailbox it came to, by the address it was sent to. A reply goes
 * to whoever replies go to; a forward to whoever the reader types, with the message quoted under their text.
 */
function FromMessage({
  what,
  title,
  accounts,
  onClose,
}: {
  what: Exclude<Writing, { kind: 'new' }>;
  title: string;
  accounts: ManageState['accounts'];
  onClose: () => void;
}) {
  // The server finds which mailbox holds it, and the reply goes from that one.
  const message = useLoaded(`message//${what.messageId}`, (signal) => api.message(what.messageId, signal), 30_000, '');
  const account = accounts.find((a) => a.id === message.data?.accountId);
  if (!message.data)
    return (
      <Panel narrow open onClose={onClose} title={title}>
        {message.error ? (
          <Note tone="failure" title="This message could not be loaded">
            {message.error}
          </Note>
        ) : (
          <Loading />
        )}
      </Panel>
    );
  if (!account) return <Waiting title={title} onClose={onClose} />;
  const choices = addressesOf(account);
  return (
    <Writer
      what={what}
      title={title}
      {...(what.kind === 'reply' ? { subtitle: answering(reveal(message.data.subject)) } : {})}
      choices={choices}
      start={what.kind === 'reply' ? replyDraft(message.data, choices, what.all) : forwardDraft(message.data, choices)}
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
  return {
    from: answeredFrom(message, choices),
    to: to.map(typed).join(', '),
    cc: cc.map(typed).join(', '),
    showCc: cc.length > 0,
    subject: '',
    text: '',
    id: null,
  };
}

/** Gmail's quote of a forwarded message, under two empty lines for the reader's own text. Its attachments do not go with it. */
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
  return { from: answeredFrom(message, choices), to: '', cc: '', showCc: false, subject: forwarding(subject), text: `\n\n${quoted.join('\n')}`, id: null };
}

function Writer({
  what,
  title,
  subtitle,
  choices,
  start,
  onClose,
}: {
  what: Writing;
  title: string;
  subtitle?: string;
  choices: readonly From[];
  start: Draft;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => keptDraft(what) ?? start);
  const change = (next: Partial<Draft>) => {
    const changed = { ...draft, ...next };
    setDraft(changed);
    keepDraft(what, changed);
  };
  // A field the reader is in is checked only up to the address they are typing; one they have left, or a press of Send, all of it.
  const [typing, setTyping] = useState<'to' | 'cc' | null>(null);
  const toField = useRef<HTMLInputElement>(null);
  // Cc asked for: entered once it is drawn.
  const ccAsked = useRef(false);
  const textField = useRef<HTMLTextAreaElement>(null);
  // A forward's text starts with the quote; the reader writes above it.
  useEffect(() => {
    if (what.kind === 'forward') textField.current?.setSelectionRange(0, 0);
  }, [what.kind]);
  const toast = useToast();
  const compose = useCompose();
  const here = useHere();
  const { busy, error, run } = useAction();

  const from = choices.find((c) => c.address === draft.from) ?? choices[0];
  const to = readAddresses(draft.to, typing === 'to');
  const cc = readAddresses(draft.cc, typing === 'cc');
  const first = to.parties[0] ?? cc.parties[0];
  // What a toast calls it: its subject, or who it is to.
  const said = (subtitle ?? draft.subject.trim()) || (first ? `To ${typed(first)}` : title);

  const send = () => {
    const all = [readAddresses(draft.to), readAddresses(draft.cc)];
    if (!from.canSend || all.some((read) => read.wrong.length > 0) || all.every((read) => read.parties.length === 0)) return;
    const id = draft.id ?? newMessageId(from.address);
    change({ id });
    const mail = { accountId: from.accountId, id, from: { address: from.address }, to: all[0].parties, cc: all[1].parties, text: draft.text };
    run(
      () => api.send(what.kind === 'reply' ? { ...mail, replyTo: { messageId: what.messageId } } : { ...mail, subject: draft.subject }),
      () => {
        keepDraft(what, null);
        toast(said, { kind: 'Sent' });
        onClose();
      },
    );
  };
  const discard = () => {
    keepDraft(what, null);
    toast(said, {
      kind: 'Draft discarded',
      undo: () => {
        keepDraft(what, draft);
        compose?.(what);
      },
    });
    onClose();
  };

  const nobody = to.parties.length + cc.parties.length === 0;
  const wrong = to.wrong.length + cc.wrong.length > 0;
  const actions = (
    <>
      <Finish
        busy={busy}
        disabled={!from.canSend || nobody || wrong}
        {...(from.canSend
          ? nobody
            ? { why: 'Say who it is to.' }
            : wrong
              ? { why: 'An address is wrong.' }
              : {}
          : { why: 'Sift may not send from this mailbox yet.' })}
        onClick={send}
      >
        Send
      </Finish>
      <Button variant="quiet" onClick={discard}>
        Discard
      </Button>
      <Failure>{error}</Failure>
    </>
  );

  return (
    <Panel
      narrow
      open
      onClose={onClose}
      title={title}
      {...(subtitle ? { subtitle } : {})}
      actions={actions}
      focus={what.kind !== 'reply' && draft.to === '' ? toField : textField}
    >
      {/* Not a Form: Enter in To or Subject must not send. */}
      <div className="flex flex-col gap-5">
        {from.canSend ? null : (
          <Note tone="look" title={`Sift may not send from ${from.accountId} yet`}>
            <p>Google asks you once to let it send as you. What you have written stays here.</p>
            <div>
              <Button variant="mark" href={`/auth/login?${new URLSearchParams({ grant: 'send', mailbox: from.accountId, to: here })}`}>
                Let Sift send
              </Button>
            </div>
          </Note>
        )}
        {choices.length > 1 ? (
          <Field inline label="From">
            <Select
              label="From"
              wide
              value={from.address}
              options={choices.map((c) => [c.address, c.address] as const)}
              onChange={(address) => change({ from: address })}
            />
          </Field>
        ) : null}
        <Field inline label="To" error={wrongAddresses(to.wrong)}>
          <Input
            ref={toField}
            aria-label="To"
            className="flex-1"
            autoComplete="off"
            value={draft.to}
            onFocus={() => setTyping('to')}
            onBlur={() => setTyping(null)}
            onChange={(event) => change({ to: event.target.value })}
          />
          {draft.showCc ? null : (
            <Button
              variant="quiet"
              onClick={() => {
                ccAsked.current = true;
                change({ showCc: true });
              }}
            >
              Cc
            </Button>
          )}
        </Field>
        {draft.showCc ? (
          <Field inline label="Cc" error={wrongAddresses(cc.wrong)}>
            <Input
              ref={(field) => {
                if (field && ccAsked.current) field.focus();
                ccAsked.current = false;
              }}
              aria-label="Cc"
              className="flex-1"
              autoComplete="off"
              value={draft.cc}
              onFocus={() => setTyping('cc')}
              onBlur={() => setTyping(null)}
              onChange={(event) => change({ cc: event.target.value })}
            />
          </Field>
        ) : null}
        {what.kind === 'reply' ? null : (
          <Field inline label="Subject">
            <Input aria-label="Subject" className="flex-1" value={draft.subject} onChange={(event) => change({ subject: event.target.value })} />
          </Field>
        )}
        <TextArea ref={textField} aria-label="Message" className="min-h-72" value={draft.text} onChange={(event) => change({ text: event.target.value })} />
      </div>
    </Panel>
  );
}
