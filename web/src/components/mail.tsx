'use client';
import { type Confidential, type Given, type MailThread, api } from '@/lib/api/endpoints.ts';
import { Fragment, useState } from 'react';
import { SenderName } from '@/components/sender.tsx';
import { useAction } from './action.ts';
import { press as outbox } from '@/lib/outbox.ts';
import { outcomeName, sureness } from '@/lib/format.ts';
import { threadKey } from '@/lib/params.ts';
import { reveal } from '@/lib/reveal.ts';
import { type Did, Meter, useToast } from '@/system';

/**
 * A conversation as a press on it needs it, and the label its row shows with that label's own action, which Archive and
 * Spam give it however sure Mild was (`src/work/press.ts`).
 */
export type Pressed = Pick<MailThread, 'accountId' | 'threadId' | 'messageIds' | 'subject'> & { label?: Shown | null };
type Shown = { name: string; does: string };
type Press = 'archive' | 'spam' | 'read' | 'unread';

/** What a press that takes conversations out of the inbox is said as. */
const DONE = { archive: 'Archived', spam: 'Marked spam' } as const;
/** The labels whose own action is the press, which the press carries out; any other is only recorded, so not shown. */
const MATCHES = { archive: ['archive', 'digest'], spam: ['spam', 'block'] } as const;

/** What a press did, for its toast: the press, the labels it gave, and the digest they go in. */
function didOf(threads: readonly Pressed[], what: 'archive' | 'spam', first: Did = { action: what, word: DONE[what] }): [Did, ...Did[]] {
  const given = threads.flatMap((t) => (t.label && (MATCHES[what] as readonly string[]).includes(t.label.does) ? [t.label] : []));
  return [
    first,
    ...[...new Set(given.map((l) => l.name))].map((word) => ({ action: 'label', word })),
    ...(given.some((l) => l.does === 'digest') ? [{ action: 'digest', word: 'In the digest' }] : []),
  ];
}

/**
 * The reader's own presses on conversations in their inbox, Mild on or off, through the outbox (`web/src/lib/outbox.ts`):
 * each shows at once. Archive and Spam say so with Undo, and go once the toast does, so Undo sends nothing; read and
 * unread go at once. Block gives each sender the Blocked standing and marks their conversation spam, with one Undo for
 * both; where a sender's own rule says more than Block would, nothing is given and `ruling` names them, for the rule
 * dialog. What comes back is said by `onOutboxFailed` (`web/src/lib/waiting.ts`).
 */
export function useMailPress(): {
  press: (threads: readonly Pressed[], what: Press, then?: () => void) => void;
  block: (threads: readonly (Pressed & { from: Confidential })[], then?: () => void) => void;
  ruling: string | null;
  stopRuling: () => void;
} {
  const [ruling, setRuling] = useState<string | null>(null);
  const { hide } = useAction();
  const undo = useAction();
  const toast = useToast();
  const said = (threads: readonly Pressed[]) => (threads.length === 1 ? reveal(threads[0].subject) || '(no subject)' : `${threads.length} conversations`);
  /** Held while its toast shows: Undo takes it back, and anything else that closes the toast sends it. */
  const held = (threads: readonly Pressed[], what: Press, title: string, did: readonly [Did, ...Did[]], undone?: () => void) => {
    const pressed = outbox(what, threads, true);
    toast(title, {
      did,
      undo: () => {
        if (pressed.cancel()) undone?.();
      },
      onGone: pressed.send,
    });
  };
  return {
    ruling,
    stopRuling: () => setRuling(null),
    block: (threads, then) => {
      if (threads.length === 0) return;
      const senders = [...new Set(threads.map((t) => reveal(t.from)))];
      hide(threads.map(threadKey), senders.length === 1 ? 'Could not block them' : 'Could not block them all', async () => {
        const given: { address: string; was: Given | null }[] = [];
        for (const address of senders) {
          const reply = await api.giveStanding({ address }, 'blocked');
          if ('theirs' in reply) {
            setRuling(address);
            return;
          }
          given.push({ address, was: reply.was });
        }
        const blocked = senders.length === 1 ? `Blocked ${senders[0]}` : `Blocked ${senders.length} senders`;
        held(threads, 'spam', said(threads), didOf(threads, 'spam', { action: 'block', word: blocked }), () =>
          undo.hide([], 'Could not undo it', () =>
            Promise.all(given.map(({ address, was }) => (was ? api.giveStanding({ address }, was) : api.clearStanding({ address })))),
          ),
        );
      });
      then?.();
    },
    press: (threads, what, then) => {
      if (threads.length === 0) return;
      if (what === 'archive' || what === 'spam') held(threads, what, said(threads), didOf(threads, what));
      else outbox(what, threads, false);
      then?.();
    },
  };
}

/** One who wrote in a conversation: their name, or their address; the reader as "me", with no address. */
export type Writer = { name: string; address: string | null };

/**
 * Who wrote in a conversation, as a mail app lists them: one name whole, several by first name. Each but the reader
 * opens their card on hover, since a name alone could be anyone.
 */
export function WhoWrote({ writers }: { writers: readonly Writer[] }) {
  const short = (name: string) => (writers.length === 1 ? name : name.includes('@') ? name.split('@')[0] : name.split(/\s+/)[0]);
  return writers.map((w, index) => (
    <Fragment key={w.address ?? ''}>
      {index > 0 ? ', ' : null}
      {w.address === null ? (
        short(w.name)
      ) : (
        <SenderName address={w.address} name={w.name === w.address ? null : w.name}>
          {short(w.name)}
        </SenderName>
      )}
    </Fragment>
  ));
}

/** The label Mild gave a message, with how sure it is; nothing for mail it never decided or could not place, which is most of an inbox. */
export function Thinks({ thinks }: { thinks: MailThread['thinks'] }) {
  if (!thinks || thinks.labelId === null) return null;
  return (
    <span className="inline-flex items-baseline gap-2 text-supporting">
      <Meter level={sureness(thinks)} />
      {thinks.labelName ?? outcomeName(thinks.disposition)}
    </span>
  );
}
