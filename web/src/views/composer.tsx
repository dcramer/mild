'use client';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDownIcon, ClockIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { reloadAll } from '@/components/action.ts';
import { type Party, type Recipient, readAddresses, typed, wrongAddresses } from '@/lib/addresses.ts';
import { api } from '@/lib/api/endpoints.ts';
import { dateTime } from '@/lib/format.ts';
import { type Draft, type Writing, draftId, emptyDraft, keepDraft, keptDraft, newMessageId, useCompose } from '@/lib/compose.ts';
import { uploadFile } from '@/lib/upload.ts';
import { useFiles } from '@/lib/attachments.ts';
import { useChosenMailbox } from '@/lib/mailbox.ts';
import { useHere } from '@/lib/params.ts';
import { reveal } from '@/lib/reveal.ts';
import {
  Ask,
  AttachButton,
  Dialog,
  Field,
  Menu,
  Button,
  DiscardButton,
  DraftBlocked,
  type DraftFile,
  DraftFiles,
  DraftLine,
  DraftText,
  Finish,
  Input,
  Loading,
  Panel,
  Recipients,
  ReplyBox,
  withTyped,
  Select,
  useNow,
  useToast,
} from '@/system';
import type { ManageState, MessageDetail } from '../../../src/dashboard/types.ts';
import { useSession, useManage, useDrafts } from '@/lib/api/reads.ts';
import { keys } from '@/lib/api/keys.ts';

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
/**
 * The person's drafts as Mild has them, which another device may have written. The composer opens without them, from
 * what this browser kept, and takes Mild's copy as it comes if it is newer.
 */
const useSaved = () => useDrafts();

/** Mild's copy of the draft for `what`, as the composer holds one, and when it is scheduled to go or why it did not. */
function savedFor(saved: ReturnType<typeof useSaved>['data'], what: Writing): { draft: Draft; sendAt: number | null; sendError: string | null } | null {
  const found = saved?.drafts.find((d) => d.id === draftId(what));
  if (!found) return null;
  const { of: _of, ...draft } = reveal(found.writing);
  return { draft, sendAt: found.sendAt, sendError: found.sendError };
}

/** A new message, in a panel of its own; `to` someone already, from their page. `draft` names it, made as it opened. */
export function Composer({ to, draft, onClose }: { to: string; draft: string; onClose: () => void }) {
  const manage = useManage({ mailbox: '' });
  const saved = useSaved();
  const accounts = manage.data?.accounts ?? [];
  const chosen = useChosenMailbox(accounts.map((a) => a.email));
  // Every address that may send, and the one it starts on even if it may not yet, so the composer can say so.
  const start = accounts.find((a) => a.id === chosen) ?? accounts.find((a) => a.primary && a.canSend) ?? accounts.find((a) => a.canSend) ?? accounts[0];
  const what: Writing = { kind: 'new', ...(to ? { to } : {}), ...(draft ? { draft } : {}) };
  // Offered only once the mailboxes are known, so there is always one to start from.
  if (!start) return null;
  return (
    <Writer
      what={what}
      saved={savedFor(saved.data, what)}
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
  const manage = useManage({ mailbox: '' });
  const saved = useSaved();
  const account = manage.data?.accounts.find((a) => a.id === message.accountId);
  if (!account) return <Loading rows={3} />;
  const choices = addressesOf(account);
  return (
    <Writer
      inline
      saved={savedFor(saved.data, what)}
      about={about}
      what={what}
      title={TITLES[what.kind === 'reply' && what.all ? 'all' : what.kind]}
      {...(what.kind === 'reply' ? { subject: answering(reveal(message.subject)) } : {})}
      choices={choices}
      start={startOf(message, choices, what)}
      startFor={(other) => startOf(message, choices, other)}
      answered={message}
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

/** How a reply or forward of `message` starts. */
const startOf = (message: MessageDetail, choices: readonly From[], what: Exclude<Writing, { kind: 'new' }>) =>
  what.kind === 'reply' ? replyDraft(message, choices, what.all) : forwardDraft(message, choices);

/** Gmail's quote of a forwarded message, under two empty lines for the reader's own text. Its files go with it (`ForwardedFiles`). */
function forwardDraft(message: MessageDetail, choices: readonly From[]): Draft {
  const subject = reveal(message.subject);
  const quoted = [
    QUOTE,
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

/** What a saved draft answers, as Mild keeps it. */
const ofWhat = (what: Writing) =>
  what.kind === 'new'
    ? ({ kind: 'new' } as const)
    : what.kind === 'reply'
      ? ({ kind: 'reply', messageId: what.messageId, all: what.all } as const)
      : ({ kind: 'forward', messageId: what.messageId } as const);

/** A pause in writing long enough to save the draft to Mild, which gives it to Gmail only once the writing has stopped. */
const SAVE_PAUSE_MS = 1500;

/** Where a forward's quote begins: what the person wrote is above it. */
const QUOTE = '---------- Forwarded message ---------';
/** Words that say a file goes with the mail. */
const SAYS_ATTACHED = /\b(attach(ed|ing|ment|ments)?|enclosed)\b/i;

/**
 * What Send asks first, as Gmail does, each in turn: about mail with no subject, and mail whose own words say a file is
 * attached when none is. A reply's subject is its message's.
 */
function doubtsAbout(what: Writing, draft: Draft, files: number): string[] {
  const own = draft.text.includes(QUOTE) ? draft.text.slice(0, draft.text.indexOf(QUOTE)) : draft.text;
  return [
    ...(what.kind !== 'reply' && draft.subject.trim() === '' ? ['Send without a subject?'] : []),
    ...(files === 0 && SAYS_ATTACHED.test(own) ? ['You mention a file, but none is attached. Send anyway?'] : []),
  ];
}

/**
 * Nothing in it the person put there: no words of their own (a forward's quote is not), no files, and the subject and
 * recipients it started with. Such a draft is neither kept nor saved, and one saved that comes to this is forgotten.
 * `subject` is a reply's, which Edit subject starts on.
 */
function blank(draft: Draft, start: Draft, subject: string | undefined): boolean {
  const own = draft.text.includes(QUOTE) ? draft.text.slice(0, draft.text.indexOf(QUOTE)) : draft.text;
  const recipients = (d: Draft) => [d.to, d.cc, d.bcc].map((line) => line.map((r) => r.address.toLowerCase()).join(',')).join(';');
  return (
    own.trim() === '' &&
    draft.files.length === 0 &&
    draft.subject.trim() === (draft.editSubject ? (subject ?? '') : start.subject).trim() &&
    recipients(draft) === recipients(start)
  );
}

/** Files being uploaded, by a key of their own until Mild gives them an id. */
interface Uploading {
  key: string;
  file: File;
  added: number;
  sent: number;
  failed?: string;
  abort: AbortController;
}

/** The composer's fields, text and presses: in a panel of their own for new mail, in place under the conversation (`inline`) for a reply or a forward. */
function Writer({
  what,
  title,
  subject,
  choices,
  start,
  startFor,
  saved,
  answered,
  inline = false,
  about,
  onClose,
}: {
  what: Writing;
  /** Mild's copy of this draft, kept if it is newer than this browser's, and its schedule. */
  saved: { draft: Draft; sendAt: number | null; sendError: string | null } | null;
  title: string;
  /** A reply's, which the server sets. */
  subject?: string;
  choices: readonly From[];
  start: Draft;
  /** How a reply or forward of the same message starts, for the menu that changes one into another. */
  startFor?: (what: Exclude<Writing, { kind: 'new' }>) => Draft;
  /** The message a reply or forward answers, whose files a forward carries, and a reply that asks. */
  answered?: MessageDetail;
  inline?: boolean;
  about?: ReactNode;
  onClose: () => void;
}) {
  const who = useSession('').data?.email ?? '';
  const client = useQueryClient();
  const [draft, setDraft] = useState(() => keptDraft(who, what, saved?.draft ?? null) ?? start);
  // Mild's copy, come since it opened: the newer is kept, as it was as it opened.
  const [offered, setOffered] = useState(saved?.draft.at ?? 0);
  if (saved && saved.draft.at !== offered) {
    setOffered(saved.draft.at);
    if (saved.draft.at > draft.at) setDraft(saved.draft);
  }
  // Said over the draft until it changes, which makes it a draft again, as in Gmail.
  const scheduled = saved !== null && draft.at <= saved.draft.at ? saved : null;
  const empty = (d: Draft) => blank(d, start, subject);
  // Saved to Mild once the writing pauses, and as the composer closes; never once it is sent or discarded.
  const saving = useRef<{ timer: ReturnType<typeof setTimeout> | null; latest: Draft | null; done: boolean; stored: boolean }>({
    timer: null,
    latest: null,
    done: false,
    stored: false,
  });
  /** Gone from Mild, and from Gmail's Drafts. */
  const forget = () => {
    saving.current.stored = false;
    void api.removeDraft(draftId(what)).then(
      () => client.invalidateQueries({ queryKey: [keys.drafts] }),
      () => {},
    );
  };
  const save = () => {
    const { latest, done } = saving.current;
    if (saving.current.timer) clearTimeout(saving.current.timer);
    saving.current.timer = null;
    saving.current.latest = null;
    if (!latest || done) return;
    if (empty(latest)) {
      if (saved || saving.current.stored) forget();
      return;
    }
    saving.current.stored = true;
    const account = choices.find((c) => c.address === latest.from) ?? choices[0];
    void api
      .saveDraft({
        id: draftId(what),
        accountId: account.accountId,
        writing: { ...latest, of: ofWhat(what) },
      })
      .then(
        () => client.invalidateQueries({ queryKey: [keys.drafts] }),
        () => {},
      );
  };
  const flush = useRef(save);
  useLayoutEffect(() => {
    flush.current = save;
  });
  useEffect(() => () => flush.current(), []);
  const finished = () => {
    if (saving.current.timer) clearTimeout(saving.current.timer);
    saving.current = { ...saving.current, timer: null, latest: null, done: true };
  };
  const change = (next: Partial<Draft> | ((was: Draft) => Partial<Draft>)) => {
    setDraft((was) => {
      const asked = typeof next === 'function' ? next(was) : next;
      // A changed draft is mail of its own: a try before the change may have gone, and must not be found and called this one.
      const changed = { ...was, ...('id' in asked ? {} : { id: null }), ...asked, at: Date.now() };
      keepDraft(who, what, empty(changed) ? null : changed);
      return changed;
    });
  };
  // Each change, once the writing pauses.
  useEffect(() => {
    if (draft.at === 0 || saving.current.done) return;
    saving.current.latest = draft;
    if (saving.current.timer) clearTimeout(saving.current.timer);
    saving.current.timer = setTimeout(() => flush.current(), SAVE_PAUSE_MS);
  }, [draft]);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  // What is typed in each line that is not a chip yet.
  const [typing, setTyping] = useState({ to: '', cc: '', bcc: '' });
  const files = useFiles(what.kind === 'forward' || draft.withFiles ? answered : undefined);
  const carried = files.filter((f) => !draft.dropped.includes(f.part));
  const toField = useRef<HTMLInputElement>(null);
  const [toInput] = useState(() => (input: HTMLInputElement | null) => {
    toField.current = input;
  });
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

  const from = choices.find((c) => c.address === draft.from) ?? choices[0];
  const addressee = draft.to[0] ?? draft.cc[0] ?? draft.bcc[0] ?? withTyped([], typing.to)[0];
  // What a toast calls it: its subject, or who it is to.
  const said = ((draft.editSubject ? draft.subject.trim() : subject) ?? draft.subject.trim()) || (addressee ? `To ${typed(addressee)}` : title);

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
  /**
   * The draft as it goes, with what is still being typed in each line as it would be once the line is left, and the
   * Message-ID of this press; null, with the draft showing what is wrong, when an address is.
   */
  const ready = () => {
    const lines = { to: withTyped(draft.to, typing.to), cc: withTyped(draft.cc, typing.cc), bcc: withTyped(draft.bcc, typing.bcc) };
    setTyping({ to: '', cc: '', bcc: '' });
    if ([...lines.to, ...lines.cc, ...lines.bcc].some((r) => r.wrong)) {
      change(lines);
      return null;
    }
    const id = draft.id ?? newMessageId(from.address);
    change({ ...lines, id });
    return { lines, id };
  };
  /** Saved to go at `at`, as Mild then sends it; Undo makes it a draft again. */
  const schedule = (at: number) => {
    if (!from.canSend || nobody || wrong || waiting) return;
    const going = ready();
    if (!going) return;
    finished();
    const writing = { ...draft, ...going.lines, id: going.id, at: Date.now(), of: ofWhat(what) };
    keepDraft(who, what, null);
    onClose();
    void api.saveDraft({ id: draftId(what), accountId: from.accountId, writing, sendAt: at }).then(
      () => {
        void client.invalidateQueries({ queryKey: [keys.drafts] });
        toast(said, {
          kind: `Scheduled for ${dateTime(at)}`,
          undo: () => {
            const again = { ...writing, at: Date.now() };
            keepDraft(who, what, again);
            void api
              .saveDraft({ id: draftId(what), accountId: from.accountId, writing: again })
              .then(() => client.invalidateQueries({ queryKey: [keys.drafts] }));
            compose?.(what);
          },
        });
      },
      (failure: unknown) => {
        keepDraft(who, what, writing);
        toast(`Not scheduled: ${said}`, {
          description: failure instanceof Error ? failure.message : String(failure),
          tone: 'failure',
          action: { label: 'Open draft', onPress: () => compose?.(what) },
        });
      },
    );
  };
  // What Send asks before it goes, when what is written needs it, with what this press has been told already.
  const [asking, setAsking] = useState<{ question: string; answered: string[] } | null>(null);
  const send = (answered: readonly string[] = []) => {
    if (!from.canSend || nobody || wrong || waiting) return;
    const question = doubtsAbout(what, draft, carried.length + draft.files.length).find((q) => !answered.includes(q));
    if (question) {
      setAsking({ question, answered: [...answered] });
      return;
    }
    setAsking(null);
    const going = ready();
    if (!going) return;
    const { lines, id } = going;
    finished();
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
      draft: draftId(what),
    };
    const carrying = carried.length > 0 && what.kind !== 'new' ? { forwarding: { messageId: what.messageId, parts: carried.map((f) => f.part) } } : {};
    const request =
      what.kind === 'reply'
        ? { ...mail, replyTo: { messageId: what.messageId }, ...(draft.editSubject && draft.subject.trim() ? { subject: draft.subject } : {}), ...carrying }
        : {
            ...mail,
            subject: draft.subject,
            ...carrying,
          };
    // Held while its toast is up, as Gmail's Undo send holds it: Undo opens the draft again, which is kept until it has gone.
    onClose();
    toast(said, {
      kind: 'Sending',
      // Saved again, since it is a draft once more.
      undo: () => compose?.(what),
      onGone: () =>
        void api.send(request).then(
          () => {
            keepDraft(who, what, null);
            toast(said, { kind: 'Sent' });
            void reloadAll(client);
          },
          (failure: unknown) =>
            toast(`Not sent: ${said}`, {
              description: failure instanceof Error ? failure.message : String(failure),
              tone: 'failure',
              action: { label: 'Open draft', onPress: () => compose?.(what) },
            }),
        ),
    });
  };
  const discard = () => {
    for (const u of uploading) u.abort.abort();
    finished();
    keepDraft(who, what, null);
    const nothing = empty(draft) && uploading.length === 0;
    if (!nothing || saved || saving.current.stored) forget();
    onClose();
    if (nothing) return;
    toast(said, {
      kind: 'Draft discarded',
      undo: () => {
        keepDraft(who, what, { ...draft, at: Date.now() });
        compose?.(what);
      },
    });
  };

  /** Reply, Reply to all or Forward of the same message instead, with what was written carried over, as Gmail's does. */
  const switchTo = (other: Exclude<Writing, { kind: 'new' }>) => {
    if (!startFor) return;
    const started = startFor(other);
    const own = draft.text.includes(QUOTE) ? draft.text.slice(0, draft.text.indexOf(QUOTE)).trimEnd() : draft.text;
    finished();
    keepDraft(who, what, null);
    if (saved || saving.current.stored) forget();
    const carried = { ...started, text: other.kind === 'forward' ? `${own}${started.text}` : own, files: draft.files, at: Date.now() };
    keepDraft(who, other, blank(carried, started, subject) ? null : carried);
    compose?.(other);
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
      {asking ? (
        <Ask key={asking.question} question={asking.question} onYes={() => send([...asking.answered, asking.question])} onNo={() => setAsking(null)}>
          Send
        </Ask>
      ) : (
        <>
          <Finish
            disabled={nobody || wrong || waiting}
            {...(nobody ? { why: 'Say who it is to.' } : wrong ? { why: 'An address is wrong.' } : waiting ? { why: 'A file is still uploading.' } : {})}
            onClick={() => send()}
          >
            Send
          </Finish>
          {nobody || wrong || waiting ? null : <ScheduleSend onSchedule={schedule} />}
          <AttachButton onFiles={attach} />
        </>
      )}
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
      {scheduled?.sendAt ? (
        <p className="px-(--gutter) pt-3 text-sm text-muted-foreground">Scheduled for {dateTime(scheduled.sendAt)}. A change makes it a draft again.</p>
      ) : scheduled?.sendError ? (
        <p className="px-(--gutter) pt-3 text-sm text-muted-foreground">Not sent as scheduled: {scheduled.sendError}</p>
      ) : null}
      {fromLine}
      <DraftLine label="To" error={wrongOf(draft.to)}>
        <Recipients
          label="To"
          value={draft.to}
          onChange={(to) => change({ to })}
          text={typing.to}
          onText={(to) => setTyping((was) => ({ ...was, to }))}
          suggest={suggest}
          inputRef={toInput}
        />
        {draft.showCc ? null : ask('cc')}
        {draft.showBcc ? null : ask('bcc')}
      </DraftLine>
      {draft.showCc ? lineFor('cc') : null}
      {draft.showBcc ? lineFor('bcc') : null}
      {what.kind === 'reply' && !draft.editSubject ? null : (
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
      <ReplyBox
        label={title}
        about={about}
        menu={what.kind === 'new' ? null : <AnswerKind what={what} draft={draft} subject={subject ?? ''} onSwitch={switchTo} onChange={change} />}
        actions={actions}
      >
        {fields}
      </ReplyBox>
    );
  return (
    <Panel narrow open onClose={onClose} title={title} actions={actions} focus={first}>
      {fields}
    </Panel>
  );
}

/** The times Gmail offers to send later, from `now`: tomorrow morning and afternoon, and Monday morning unless that is tomorrow's. */
function laterTimes(now: Date): (readonly [string, number])[] {
  const at = (days: number, hour: number) => {
    const day = new Date(now);
    day.setDate(day.getDate() + days);
    day.setHours(hour, 0, 0, 0);
    return day.getTime();
  };
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [['Tomorrow morning', at(1, 8)], ['Tomorrow afternoon', at(1, 13)], ...(toMonday === 1 ? [] : [['Monday morning', at(toMonday, 8)] as const])];
}

/** `ms` as a `datetime-local` input writes it, in this browser's zone. */
const localInput = (ms: number) => {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** Send later: beside Send, the times Gmail offers, and one picked. */
function ScheduleSend({ onSchedule }: { onSchedule: (at: number) => void }) {
  const [picking, setPicking] = useState(false);
  const [times] = useState(() => laterTimes(new Date()));
  const [picked, setPicked] = useState(() => localInput(times[0][1]));
  const now = useNow();
  const at = new Date(picked).getTime();
  const past = !Number.isFinite(at) || (now !== null && at <= now);
  return (
    <>
      <Menu
        label="Schedule send"
        trigger={
          <span className="flex size-(--control) items-center justify-center">
            <ClockIcon aria-hidden className="size-4" />
          </span>
        }
        heading={<p className="font-medium">Schedule send</p>}
        items={[
          ...times.map(([label, ms]) => ({ label, note: dateTime(ms), onSelect: () => onSchedule(ms) })),
          { label: 'Pick a date and time…', onSelect: () => setPicking(true) },
        ]}
      />
      <Dialog
        open={picking}
        onClose={() => setPicking(false)}
        title="Schedule send"
        footer={
          <>
            <Button variant="ink" disabled={past} {...(past ? { why: 'Choose a time from now on.' } : {})} onClick={() => (setPicking(false), onSchedule(at))}>
              Schedule send
            </Button>
            <Button variant="quiet" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <Field label="Send at">
          <Input type="datetime-local" value={picked} onChange={(event) => setPicked(event.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

/**
 * A reply's or forward's menu, at the head of its box: what it is, changed to Reply, Reply to all or Forward, and for a
 * reply, its subject to edit and the files of the message it answers to include, as Gmail's reply menu has them.
 */
function AnswerKind({
  what,
  draft,
  subject,
  onSwitch,
  onChange,
}: {
  what: Exclude<Writing, { kind: 'new' }>;
  draft: Draft;
  /** A reply's subject as it goes unless edited. */
  subject: string;
  onSwitch: (what: Exclude<Writing, { kind: 'new' }>) => void;
  onChange: (next: Partial<Draft>) => void;
}) {
  const shown = what.kind === 'forward' ? 'Forward' : what.all ? 'Reply to all' : 'Reply';
  const kinds = [
    ['Reply', { kind: 'reply', messageId: what.messageId, all: false }],
    ['Reply to all', { kind: 'reply', messageId: what.messageId, all: true }],
    ['Forward', { kind: 'forward', messageId: what.messageId }],
  ] as const;
  return (
    <Menu
      label={`${shown}: change it`}
      trigger={
        <span className="flex h-(--control) items-center gap-1 px-1.5 font-semibold text-foreground">
          {shown}
          <ChevronDownIcon aria-hidden className="size-3.5" />
        </span>
      }
      items={[
        ...kinds.map(([label, other]) => ({ label, on: label === shown, onSelect: () => label !== shown && onSwitch(other) })),
        ...(what.kind === 'reply'
          ? [
              {
                group: 'More',
                items: [
                  { label: 'Edit subject', disabled: draft.editSubject === true, onSelect: () => onChange({ editSubject: true, subject }) },
                  { label: 'Include original attachments', on: draft.withFiles === true, onSelect: () => onChange({ withFiles: !draft.withFiles }) },
                ],
              },
            ]
          : []),
      ]}
    />
  );
}
