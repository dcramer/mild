'use client';
import { eq, inArray, isNull, or, useLiveQuery } from '@tanstack/react-db';
import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import type { useAsk } from '@/components/ask.tsx';
import type { Copied } from '@/lib/copy.ts';
import type { MailThread, MailView } from '@/lib/api/endpoints.ts';
import { conversations, copiedKey, useWhole } from '@/lib/copy.ts';
import { useOutbox } from '@/lib/waiting.ts';
import { useStarted } from '@/lib/started.ts';
import { MOVES_OUT } from '@/lib/words.ts';
import { threadKey } from '@/lib/rows.ts';
import { useMailThreads } from '@/lib/api/reads.ts';
import type { Listed } from './listed.ts';

/** How long a narrowing of the list is kept once nothing shows it: longer than a conversation is read for. */
const LIST_KEPT_MS = 30 * 60_000;
/**
 * Conversations of the copy drawn at first, and added each time the end of the list comes near. Drawn whole, an inbox of
 * thousands froze the page for seconds at every change the copy took in.
 */
const COPY_PAGE = 100;
/** Rows drawn first, more than a screen holds: on a phone, drawing a hundred at once is most of a second before any shows. */
const FIRST_DRAWN = 30;

/**
 * The conversations Inbox lists, but those a press took off it, and whether they are still coming. The inbox is drawn
 * from the copy in this browser; a search, or what Ask made of one, looks through all the mail Mild keeps, which only the
 * server can.
 */
export function useConversations({
  on,
  drafting,
  view,
  label,
  unread,
  q,
  ask,
  mailbox,
  hidden,
  rowOf,
}: {
  on: boolean;
  drafting: boolean;
  view: MailView;
  label: string;
  unread: string;
  q: string;
  ask: Pick<ReturnType<typeof useAsk>, 'query' | 'narrowed'>;
  mailbox: string;
  hidden: ReadonlySet<string>;
  rowOf: (row: Copied | MailThread) => Listed;
}) {
  const query = { view, label, q, unread: unread === '1', ...ask.query } as const;
  const started = useStarted();
  const local = on && started && q === '' && !ask.narrowed && !drafting;
  // Asked only once the page has started: until then it cannot say whether the copy will draw the list.
  const server = on && started && !local && !drafting;
  const pages = useMailThreads(server, query, ask.query);
  const [reach, setReach] = useState(COPY_PAGE);
  const copy = useLiveQuery({
    query: (from) => {
      if (!local) return undefined;
      let rows = from.from({ c: conversations() }).where(({ c }) => eq(c.inbox, true));
      if (mailbox) rows = rows.where(({ c }) => eq(c.accountId, mailbox));
      if (unread === '1') rows = rows.where(({ c }) => eq(c.unread, true));
      if (label) rows = rows.where(({ c }) => eq(c.labelId, label));
      if (view === 'needs') rows = rows.where(({ c }) => or(isNull(c.disposition), inArray(c.disposition, ['keep', 'review'])));
      if (view === 'sorted') rows = rows.where(({ c }) => inArray(c.disposition, [...MOVES_OUT]));
      // One past the rows drawn, to know there are more.
      return rows.orderBy(({ c }) => c.newestAt, 'desc').limit(reach + 1);
    },
    // Kept while the reader hides the list, so going back draws it as it was, the row last shown still there to take the focus.
    gcTime: LIST_KEPT_MS,
  });
  const whole = useWhole();
  // The copy hands its rows over as an urgent update, which would mount a view's or the next hundred's rows in one go:
  // deferred, React draws them in slices while the rows shown stay up.
  const deferred = useDeferredValue(copy.data);
  // Except the first rows, drawn as soon as the copy has them: deferred, anything else the page does goes first.
  const copied = deferred?.length ? deferred : copy.data;
  const reached = useDeferredValue(reach);
  // The first screen of rows, then the rest behind it.
  const [drawing, setDrawing] = useState(FIRST_DRAWN);
  const some = (copied?.length ?? 0) > 0;
  useEffect(() => {
    if (some && drawing === FIRST_DRAWN) startTransition(() => setDrawing(Infinity));
  }, [some, drawing]);
  const more = local ? (copied?.length ?? 0) > reached && drawing > reached : pages.more;
  const listed: Listed[] = local ? (copied ?? []).slice(0, Math.min(reached, drawing)).map(rowOf) : pages.pages.flatMap((page) => page.threads).map(rowOf);
  const pressed = useOutbox().hidden;
  const threads = listed.filter((t) => !hidden.has(threadKey(t)) && !pressed.has(copiedKey(t.accountId, t.threadId)));
  // An empty list is nothing only once the copy is whole, and drawn: the deferred list may still be behind it.
  const waiting = local ? !copy.isReady || (threads.length === 0 && (!whole || deferred !== copy.data)) : !server || pages.loading;
  return { local, threads, waiting, more, next: local ? () => setReach((r) => r + COPY_PAGE) : pages.next, error: pages.error };
}
