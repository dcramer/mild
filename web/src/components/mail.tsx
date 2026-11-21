'use client';
import { type Confidential, type Given, type MailThread, api } from '@/lib/api.ts';
import { useState } from 'react';
import { useAction } from '@/lib/action.ts';
import { caughtUp, copied, copiedKey, markCopied } from '@/lib/copy.ts';
import { outcomeName, sureness } from '@/lib/format.ts';
import { threadKey } from '@/lib/params.ts';
import { reveal } from '@/lib/reveal.ts';
import { Meter, useToast } from '@/system';

/** A conversation as a press on it needs it. */
export type Pressed = Pick<MailThread, 'accountId' | 'threadId' | 'messageIds' | 'subject'>;
type Press = 'archive' | 'spam' | 'read' | 'unread';

/** What a press that takes conversations out of the inbox is said as, done and failed. */
const OUT = {
  archive: { done: 'Archived', one: 'Could not archive it', many: 'Could not archive them' },
  spam: { done: 'Marked spam', one: 'Could not mark it spam', many: 'Could not mark them spam' },
} as const;

// Changes go to Gmail one after another, in the order pressed: opening a conversation marks it read, and Mark unread
// pressed straight after must not land first and be undone by it.
let pressing: Promise<unknown> = Promise.resolve();

/**
 * The reader's own presses on conversations in their inbox, Mild on or off. Archive and Spam take them off the list at
 * once and offer Undo; read and unread are on every message of each, but unread only on its newest, as Gmail marks it.
 * Block gives each sender the Blocked standing and marks their conversation spam, with one Undo for both; where a
 * sender's own rule says more than Block would, nothing is given and `ruling` names them, for the rule dialog.
 */
export function useMailPress(): {
  press: (threads: readonly Pressed[], what: Press, then?: () => void) => void;
  block: (threads: readonly (Pressed & { from: Confidential })[], then?: () => void) => void;
  ruling: string | null;
  stopRuling: () => void;
  error: string | null;
} {
  const [ruling, setRuling] = useState<string | null>(null);
  const { hide, run, error } = useAction();
  const undo = useAction();
  const toast = useToast();
  const send = (threads: readonly Pressed[], what: Press) => {
    const sent = pressing.then(async () => {
      const replies = await Promise.all(
        [...Map.groupBy(threads, (t) => t.accountId)].map(([accountId, mine]) =>
          api.changeMail({ accountId, messageIds: mine.flatMap((t) => (what === 'unread' ? t.messageIds.slice(-1) : t.messageIds)), change: what }),
        ),
      );
      // What a press hid stays hidden until the copy of the inbox holds the change, so it does not come back meanwhile.
      await caughtUp();
      return { actions: replies.flatMap((reply) => reply.actions), missed: replies.some((reply) => reply.missed > 0) };
    });
    pressing = sent.catch(() => undefined);
    return sent;
  };
  /** What Gmail did not take, said as a failure once what it did take can be undone. Counted in messages, so said without a number. */
  const unless = (missed: boolean, threads: readonly Pressed[]) => {
    if (missed) throw new Error(`Gmail did not take ${threads.length === 1 ? 'it' : 'all of them'}. Try again.`);
  };
  const said = (threads: readonly Pressed[]) => (threads.length === 1 ? reveal(threads[0].subject) || '(no subject)' : `${threads.length} conversations`);
  return {
    error,
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
        const { actions, missed } = await send(threads, 'spam');
        toast(senders.length === 1 ? `Blocked ${senders[0]}` : `Blocked ${senders.length} senders`, {
          kind: 'Rule added',
          undo: () =>
            undo.hide([], 'Could not undo it', async () => {
              await Promise.all(actions.map((id) => api.undo(id)));
              await Promise.all(given.map(({ address, was }) => (was ? api.giveStanding({ address }, was) : api.clearStanding({ address }))));
            }),
        });
        unless(missed, threads);
      });
      then?.();
    },
    press: (threads, what, then) => {
      if (threads.length === 0) return;
      if (what !== 'archive' && what !== 'spam') {
        const work = async () => {
          const { missed } = await send(threads, what);
          unless(missed, threads);
        };
        const keys = threads.map((t) => copiedKey(t.accountId, t.threadId));
        // Shown at once where the copy holds them all, and undone if Gmail refuses.
        if (keys.every((key) => copied(key))) run(async () => await markCopied({ keys, unread: what === 'unread', work }).when('settled'), then);
        else run(work, then);
        return;
      }
      const words = OUT[what];
      hide(threads.map(threadKey), threads.length === 1 ? words.one : words.many, async () => {
        const { actions, missed } = await send(threads, what);
        if (actions.length > 0)
          toast(said(threads), {
            kind: words.done,
            undo: () => undo.hide([], 'Could not undo it', () => Promise.all(actions.map((id) => api.undo(id)))),
          });
        unless(missed, threads);
      });
      then?.();
    },
  };
}

/** Who wrote in a conversation, as a mail app lists them: one name whole, several by first name. */
export function whoWrote(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  return names.map((name) => (name.includes('@') ? name.split('@')[0] : name.split(/\s+/)[0])).join(', ');
}

/** The label Mild gave a message, with how sure it is; nothing for mail it never decided or could not place, which is most of an inbox. */
export function Thinks({ thinks }: { thinks: MailThread['thinks'] }) {
  if (!thinks || thinks.labelId === null) return null;
  return (
    <span className="inline-flex items-baseline gap-2">
      <Meter level={sureness(thinks)} />
      {thinks.labelName ?? outcomeName(thinks.disposition)}
    </span>
  );
}
