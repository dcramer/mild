'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { ago, arrived, heard } from '@/lib/format.ts';

/**
 * How long ago `at` was ("just now", "5 min ago", a date). Drawn only once the page runs in the browser: the
 * server's clock and time zone are not the reader's, and text the server drew differently would not match.
 */
export function Ago({ at }: { at: number }) {
  const now = useNow();
  return now === null ? null : <time dateTime={new Date(at).toISOString()}>{ago(at)}</time>;
}

/** When mail came, as a mail app says it under its day: "2:39 PM", "Tue", "Nov 6". Drawn in the browser, as `Ago` is. */
export function Arrived({ at }: { at: number }) {
  const now = useNow();
  return now === null ? null : <time dateTime={new Date(at).toISOString()}>{arrived(at, now)}</time>;
}

/** When a message in a conversation came, short: "7:32 PM" today, "Nov 19, 7:32 PM" before. Drawn in the browser, as `Ago` is. */
export function Heard({ at }: { at: number }) {
  const now = useNow();
  return now === null ? null : <time dateTime={new Date(at).toISOString()}>{heard(at, now)}</time>;
}

/**
 * The time in the browser to the `ms`, kept current, so what is drawn from it ("1 min ago", the time left) keeps up with
 * nothing loaded. Null on the server, whose clock and zone are not the reader's. Looked at twice an `ms`, so it is never
 * more than half of one behind.
 */
export function useNow(ms = 60_000): number | null {
  const every = useCallback(
    (tick: () => void) => {
      const timer = setInterval(tick, ms / 2);
      return () => clearInterval(timer);
    },
    [ms],
  );
  return useSyncExternalStore(every, () => Math.floor(Date.now() / ms) * ms, onServer);
}
const onServer = () => null;
