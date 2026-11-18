'use client';
import { useSyncExternalStore } from 'react';
import { ago } from '@/lib/format.ts';

const MINUTE = 60_000;
const everyHalfMinute = (tick: () => void) => {
  const timer = setInterval(tick, MINUTE / 2);
  return () => clearInterval(timer);
};
const thisMinute = () => Math.floor(Date.now() / MINUTE);
const onServer = () => null;

/**
 * How long ago `at` was ("just now", "5 min ago", a date). Drawn only once the page runs in the browser: the
 * server's clock and time zone are not the reader's, and text the server drew differently would not match.
 */
export function Ago({ at }: { at: number }) {
  const minute = useSyncExternalStore(everyHalfMinute, thisMinute, onServer);
  return minute === null ? null : <time dateTime={new Date(at).toISOString()}>{ago(at)}</time>;
}
