import { useEffect, useSyncExternalStore } from 'react';
import { useToast } from '@/system';

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

const failures = new Set<(failed: Failed) => void>();
export const tellFailed = (failed: Failed) => failures.forEach((listener) => listener(failed));

const FAILED = {
  archive: ['Could not archive it', 'Could not archive them'],
  spam: ['Could not mark it spam', 'Could not mark them spam'],
  read: ['Could not mark it read', 'Could not mark them read'],
  unread: ['Could not mark it unread', 'Could not mark them unread'],
} as const;

/** Says each press that came back, wherever it was made: drawn once, for the whole page. */
export function useOutboxFailures(): void {
  const toast = useToast();
  useEffect(() => {
    const said = ({ change, count, why }: Failed) => toast(FAILED[change][count === 1 ? 0 : 1], { tone: 'failure', description: why });
    failures.add(said);
    return () => void failures.delete(said);
  }, [toast]);
}
