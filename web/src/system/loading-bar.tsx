'use client';
import { useLinkStatus } from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * A line running across the top of the window while the reader waits on something with nothing else to show for it:
 * the page while the server draws its frame, a screen a link is still fetching, data a screen has none of yet. It
 * fades in only after a moment, so what arrives at once shows nothing.
 */
export function LoadingBar({ on }: { on: boolean }) {
  return on ? <div aria-hidden className="loading-bar" /> : null;
}

let going = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** In a `Link`: says while the screen it goes to has not arrived (`useGoing`). Nothing, once it was fetched ahead. */
export function LinkPending() {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    going += 1;
    changed();
    return () => {
      going -= 1;
      changed();
    };
  }, [pending]);
  return null;
}

/** Whether a link was pressed and its screen has not arrived. */
export const useGoing = () =>
  useSyncExternalStore(
    subscribe,
    () => going > 0,
    () => false,
  );
