'use client';
import type { ReactNode } from 'react';
import { readAddresses } from '@/lib/addresses.ts';
import { useManage, useDrafts } from '@/lib/api/reads.ts';
import { addressesOf, answering, startOf } from '@/lib/answering.ts';
import { type Writing, draftId, emptyDraft } from '@/lib/compose.ts';
import { useChosenMailbox } from '@/lib/mailbox.ts';
import { reveal } from '@/lib/reveal.ts';
import { Loading } from '@/system';
import type { MessageDetail } from '../../../../src/dashboard/types.ts';
import { type SavedDraft, Writer } from './writer.tsx';

const TITLES = { new: 'New message', reply: 'Reply', all: 'Reply to all', forward: 'Forward' } as const;

/**
 * Mild's copy of the draft for `what`, as the composer holds one, and when it is scheduled to go or why it did not:
 * another device may have written it. The composer opens without it, from what this browser kept, and takes Mild's copy
 * as it comes if it is newer.
 */
function savedFor(saved: ReturnType<typeof useDrafts>['data'], what: Writing): SavedDraft {
  const found = saved?.drafts.find((d) => d.id === draftId(what));
  if (!found) return null;
  const { of: _of, ...draft } = reveal(found.writing);
  return { draft, sendAt: found.sendAt, sendError: found.sendError };
}

/**
 * A new message, in a narrow panel over whatever is open: From (when there is more than one mailbox or address), To, Cc
 * on a press, a subject and the text. What is written is kept in this browser until it is sent or discarded, so closing
 * it, or a reload, loses nothing. `to` someone already, from their page; `draft` names it, made as it opened.
 */
export function Composer({ to, draft, onClose }: { to: string; draft: string; onClose: () => void }) {
  const manage = useManage({ mailbox: '' });
  const saved = useDrafts();
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
      // Every mailbox, so which one it goes from is always in view and can be changed; one Mild may not send from yet says so when chosen.
      choices={accounts.flatMap(addressesOf)}
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
  const saved = useDrafts();
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
