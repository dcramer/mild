import { useSyncExternalStore } from 'react';

export interface Unread {
  accountId: string;
  threadId: string;
}

let now: readonly Unread[] | null = null;
const listeners = new Set<() => void>();

export function tellUnread(unread: readonly Unread[] | null): void {
  now = unread;
  for (const listener of listeners) listener();
}

/**
 * The unread conversations in the inbox, as the copy (`web/src/lib/copy.ts`) holds them, presses on
 * their way included: Inbox's count, and the app icon's while Inbox is on. Apart from the copy, so the frame reads it without
 * loading the copy, which loads only where Inbox is on. Null until the copy is whole, since part of it counts too few.
 */
export function useUnread(): readonly Unread[] | null {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    () => now,
    () => null,
  );
}
