'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { reloadAll } from '@/components/action.ts';
import { type Recipient, typed } from '@/lib/addresses.ts';
import { api } from '@/lib/api/endpoints.ts';
import { type From, ofWhat, ownOf, withQuote } from '@/lib/answering.ts';
import { type useAutosave, reloadDrafts } from '@/lib/autosave.ts';
import { type Draft, type Writing, draftId, keepDraft, newMessageId, useCompose } from '@/lib/compose.ts';
import { blank, doubtsAbout } from '@/lib/draft-checks.ts';
import { dateTime } from '@/lib/format.ts';
import { sentAs, startSending, stopSending } from '@/lib/sending.ts';
import { withTyped, useToast } from '@/system';
import type { MessageAttachment } from '../../../../src/dashboard/types.ts';
import type { useDraftFiles } from './files.ts';

interface Typing {
  to: string;
  cc: string;
  bcc: string;
}

/**
 * What the composer's presses do with the draft: Send, Schedule send, Discard, and changing a reply into another
 * answer to the same message, each with its toast and Undo; what Send asks first (`asking`); and why Send waits
 * (`nobody`, `wrong`, `waiting`).
 */
export function usePresses({
  who,
  what,
  title,
  subject,
  startFor,
  autosave: { draft, change, finished, forget, held },
  empty,
  typing,
  setTyping,
  from,
  quote,
  carried,
  uploading,
  onClose,
}: {
  who: string;
  what: Writing;
  title: string;
  subject: string | undefined;
  startFor: ((what: Exclude<Writing, { kind: 'new' }>) => Draft) | undefined;
  autosave: ReturnType<typeof useAutosave>;
  empty: (draft: Draft) => boolean;
  typing: Typing;
  setTyping: (typing: Typing) => void;
  from: From;
  /** A reply's quote of the message it answers, which goes under what is written. */
  quote: string | null;
  carried: readonly MessageAttachment[];
  uploading: ReturnType<typeof useDraftFiles>['uploading'];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const compose = useCompose();

  const addressee = draft.to[0] ?? draft.cc[0] ?? draft.bcc[0] ?? withTyped([], typing.to)[0];
  // What a toast calls it: its subject, or who it is to.
  const said = ((draft.editSubject ? draft.subject.trim() : subject) ?? draft.subject.trim()) || (addressee ? `To ${typed(addressee)}` : title);

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
    const writing = {
      ...draft,
      ...going.lines,
      text: withQuote(draft, quote),
      ...(quote ? { quoted: true } : {}),
      id: going.id,
      at: Date.now(),
      of: ofWhat(what),
    };
    keepDraft(who, what, null);
    onClose();
    void api.saveDraft({ id: draftId(what), accountId: from.accountId, writing, sendAt: at }).then(
      () => {
        void reloadDrafts(client);
        toast(said, {
          kind: `Scheduled for ${dateTime(at)}`,
          undo: () => {
            const again = { ...writing, at: Date.now() };
            keepDraft(who, what, again);
            void api.saveDraft({ id: draftId(what), accountId: from.accountId, writing: again }).then(() => reloadDrafts(client));
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
      text: withQuote(draft, quote),
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
    // A reply is in its conversation meanwhile, as Gmail draws it.
    onClose();
    const named = draftId(what);
    if (what.kind === 'reply')
      startSending({ draft: named, answers: what.messageId, from: from.address, to: mail.to, cc: mail.cc, text: mail.text, sent: null });
    toast(said, {
      kind: 'Sending',
      // Saved again, since it is a draft once more.
      undo: () => {
        stopSending(named);
        compose?.(what);
      },
      onGone: () =>
        void api.send(request).then(
          ({ id: sent }) => {
            sentAs(named, sent);
            keepDraft(who, what, null);
            toast(said, { kind: 'Sent' });
            void reloadAll(client);
          },
          (failure: unknown) => {
            stopSending(named);
            toast(`Not sent: ${said}`, {
              description: failure instanceof Error ? failure.message : String(failure),
              tone: 'failure',
              action: { label: 'Open draft', onPress: () => compose?.(what) },
            });
          },
        ),
    });
  };
  const discard = () => {
    for (const u of uploading) u.abort.abort();
    finished();
    keepDraft(who, what, null);
    const nothing = empty(draft) && uploading.length === 0;
    if (!nothing || held()) forget();
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
    const own = ownOf(draft.text).trimEnd();
    finished();
    keepDraft(who, what, null);
    if (held()) forget();
    const carried = { ...started, text: other.kind === 'forward' ? `${own}${started.text}` : own, files: draft.files, at: Date.now() };
    keepDraft(who, other, blank(carried, started, subject) ? null : carried);
    compose?.(other);
  };

  return { send, schedule, discard, switchTo, asking, dismiss: () => setAsking(null), nobody, wrong, waiting };
}
