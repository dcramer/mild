import { createContext, useContext } from 'react';
import { panelEntry, setParams } from './params.ts';

/** What the composer writes: a new message, or a reply to one, to its sender alone or (`all`) to everyone on it too. */
export type Writing = { kind: 'new' } | { kind: 'reply'; messageId: string; all: boolean };

/**
 * Open the composer. In the address, as a message is (`?compose=new`, or `?compose=reply` or `all` with the message
 * it answers, `?message=<id>`), so Back closes it; a reply opened from the reader leaves the reader under it.
 */
export function openComposer(what?: { replyTo?: { messageId: string }; all?: boolean }) {
  const reply = what?.replyTo;
  setParams(reply ? { compose: what.all ? 'all' : 'reply', message: reply.messageId } : { compose: 'new' }, {
    state: { panel: true },
  });
}

export function closeComposer() {
  if (panelEntry()) window.history.back();
  else setParams({ compose: '' });
}

/** What the address says the composer is writing, or null when it is closed. */
export function writing(compose: string, messageId: string): Writing | null {
  if (compose === 'new') return { kind: 'new' };
  if ((compose === 'reply' || compose === 'all') && messageId) return { kind: 'reply', messageId, all: compose === 'all' };
  return null;
}

/** Opens the composer; null while Inbox is off, when nothing offers it. */
export const ComposeContext = createContext<typeof openComposer | null>(null);

/** For a press that writes a message: `compose()` for a new one, `compose({ replyTo, all })` to answer one. */
export const useCompose = () => useContext(ComposeContext);

/** Everything in the composer, kept in this browser until it is sent or discarded. */
export interface Draft {
  /** The address it is from; empty for the one it starts on. */
  from: string;
  to: string;
  cc: string;
  /** Cc was asked for, or has something in it. */
  showCc: boolean;
  subject: string;
  text: string;
  /** Its Message-ID, made at the first press of Send and kept until it has gone, so trying again cannot send it twice. */
  id: string | null;
}

const draftKey = (what: Writing) => (what.kind === 'new' ? 'sift:draft:new' : `sift:draft:${what.messageId}`);

/** The unsent draft kept for this, if any. */
export function keptDraft(what: Writing): Draft | null {
  try {
    const stored = window.localStorage.getItem(draftKey(what));
    return stored === null ? null : (JSON.parse(stored) as Draft);
  } catch {
    return null;
  }
}

/** Keep a draft, or with null forget it. */
export function keepDraft(what: Writing, draft: Draft | null) {
  try {
    if (draft === null) window.localStorage.removeItem(draftKey(what));
    else window.localStorage.setItem(draftKey(what), JSON.stringify(draft));
  } catch {
    // Not kept; it is still there until the composer is closed.
  }
}

/** A Message-ID for mail from `from`, made once for a press of Send. */
export function newMessageId(from: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `<${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}@${from.slice(from.lastIndexOf('@') + 1)}>`;
}
