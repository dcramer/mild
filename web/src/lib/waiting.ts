import { useSyncExternalStore } from 'react';

/**
 * What the outbox (`web/src/lib/outbox.ts`) tells every screen: how many presses wait to reach Mild, which
 * conversations they take out of the inbox, and each that came back. Apart from it, so the frame draws them without
 * loading the copy of the inbox, which loads only where Inbox is on.
 */

export type Change = 'archive' | 'spam' | 'read' | 'unread';
/** Why a press came back: Mild refused it, or Gmail did not take all of it. */
export interface Failed {
  change: Change;
  count: number;
  why: string;
}
interface Waiting {
  waiting: number;
  hidden: ReadonlySet<string>;
}

const EMPTY: Waiting = { waiting: 0, hidden: new Set() };
let now = EMPTY;
const listeners = new Set<() => void>();
export function tellWaiting(waiting: Waiting): void {
  now = waiting;
  for (const listener of listeners) listener();
}

/** How many presses wait to reach Mild, and the conversations they take out of the inbox, by `copiedKey`. */
export function useOutbox(): Waiting {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    () => now,
    () => EMPTY,
  );
}

const failures = new Set<(title: string, why: string) => void>();
export const tellFailed = ({ change, count, why }: Failed) => failures.forEach((listener) => listener(FAILED[change][count === 1 ? 0 : 1], why));

const FAILED = {
  archive: ['Could not archive it', 'Could not archive them'],
  spam: ['Could not mark it spam', 'Could not mark them spam'],
  read: ['Could not mark it read', 'Could not mark them read'],
  unread: ['Could not mark it unread', 'Could not mark them unread'],
} as const;

/** Told each press that came back, wherever it was made, until the returned function is called. */
export function onOutboxFailed(listener: (title: string, why: string) => void): () => void {
  failures.add(listener);
  return () => void failures.delete(listener);
}
