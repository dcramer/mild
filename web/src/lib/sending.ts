import { useSyncExternalStore } from 'react';
import type { Party } from './addresses.ts';

/**
 * Replies pressed Send on, drawn in their conversation at once, as Gmail draws one, while Undo is offered and until
 * Gmail's copy has reached it. One per draft: sending it again replaces the last.
 */
export interface Sending {
  draft: string;
  /** The message it answers, which places it in its conversation. */
  answers: string;
  from: string;
  to: readonly Party[];
  cc: readonly Party[];
  text: string;
  /** Gmail's id for it, once it has gone: the conversation's own copy takes its place from then. */
  sent: string | null;
}

const NONE: readonly Sending[] = [];
let now = NONE;
const listeners = new Set<() => void>();
const tell = (next: readonly Sending[]) => {
  now = next;
  for (const listener of listeners) listener();
};

export const startSending = (sending: Sending) => tell([...now.filter((s) => s.draft !== sending.draft), sending]);
export const sentAs = (draft: string, id: string) => tell(now.map((s) => (s.draft === draft ? { ...s, sent: id } : s)));
export const stopSending = (draft: string) => {
  if (now.some((s) => s.draft === draft)) tell(now.filter((s) => s.draft !== draft));
};

/** Every reply on its way, for the conversations drawn. */
export const useSending = (): readonly Sending[] =>
  useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    () => now,
    () => NONE,
  );
