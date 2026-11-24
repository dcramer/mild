'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { type MessageRef, useOpenMessages } from '@/lib/open-messages.ts';
import { threadKey } from '@/lib/rows.ts';
import { usePhone } from '@/system';
import type { Listed } from './listed.ts';

type Press = 'archive' | 'spam' | 'read' | 'unread';

/** What a row's presses do, the same from one draw to the next, so a row is drawn again only when its own conversation changes. */
export type Hands = {
  select: (thread: Listed, on: boolean) => void;
  hold: (thread: Listed) => void;
  open: (thread: Listed) => void;
  press: (threads: readonly Listed[], what: Press) => void;
  block: (threads: readonly Listed[]) => void;
};

/** Which rows are selected, and the `Hands` every row is given, which act on the list as last drawn. */
export function useHands({
  threads,
  refs,
  press,
  block,
}: {
  threads: readonly Listed[];
  refs: MessageRef[];
  press: (threads: readonly Listed[], what: Press) => void;
  block: (threads: readonly Listed[]) => void;
}) {
  const onOpen = useOpenMessages();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // On a phone, once a row is held, a press on a row selects it or lets it go, as a phone's own mail app does.
  const phone = usePhone();
  const choosing = phone && selected.size > 0;
  const drawn = useRef({ threads, refs, press, block, onOpen, choosing, selected });
  useLayoutEffect(() => {
    drawn.current = { threads, refs, press, block, onOpen, choosing, selected };
  });
  const [hands] = useState<Hands>(() => {
    const select = (thread: Listed, on: boolean) =>
      setSelected((was) => {
        const changed = new Set(was);
        if (on) changed.add(threadKey(thread));
        else changed.delete(threadKey(thread));
        return changed;
      });
    return {
      select,
      hold: (thread) => select(thread, true),
      open: (thread) => {
        const { threads, refs, onOpen, choosing, selected } = drawn.current;
        if (choosing) return select(thread, !selected.has(threadKey(thread)));
        onOpen(
          refs,
          threads.findIndex((t) => threadKey(t) === threadKey(thread)),
        );
      },
      press: (threads, what) => drawn.current.press(threads, what),
      block: (threads) => drawn.current.block(threads),
    };
  });
  return { selected, setSelected, hands };
}
