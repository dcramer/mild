'use client';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { type MailConversation, type MessageDetail, api } from '@/lib/api/endpoints.ts';
import { keys } from '@/lib/api/keys.ts';
import { changeLoaded, useLoaded } from '@/lib/api/query.ts';
import { useMessage } from '@/lib/api/reads.ts';
import { conversationOf, conversations, copied, copiedKey } from '@/lib/copy.ts';
import { useStarted } from '@/lib/started.ts';

/**
 * The conversation `threadId`, none for no id. One in the inbox is in this browser's copy already (docs/sync.md); the
 * server is asked for one that is not. `markRead` changes what was read of it, for a press here that marked it read.
 */
export function useConversation(accountId: string, threadId: string | undefined) {
  const load = keys.thread(accountId, threadId ?? '');
  const key = threadId && accountId ? copiedKey(accountId, threadId) : null;
  const started = useStarted();
  const inCopy = useLiveQuery({ query: (from) => (key && started ? from.from({ c: conversations() }).where(({ c }) => eq(c.key, key)) : undefined) });
  const thread = useLoaded(
    load,
    (signal) => {
      const held = key ? copied(key) : undefined;
      return held ? Promise.resolve(conversationOf(held)) : threadId ? api.mailThread(threadId, signal, accountId) : Promise.resolve(null);
    },
    30_000,
    '',
  );
  // The live query answers only after the first draw, which would draw a page of placeholders before the conversation.
  const fromCopy = inCopy.data?.[0] ?? (key && started ? copied(key) : undefined);
  return {
    fromCopy,
    conversation: threadId ? (fromCopy ? conversationOf(fromCopy) : thread.data) : null,
    thread,
    markRead: () => changeLoaded<MailConversation | null>(load, (read) => read && { ...read, messages: read.messages.map((m) => ({ ...m, unread: false })) }),
  };
}

/** A message of the conversation: the reader's own as it was loaded, any other read as it is first wanted and kept. */
export function useConversationMessage(id: string, newest: MessageDetail): { detail: MessageDetail | null; error: string | null } {
  const other = id === newest.messageId ? null : id;
  const loaded = useMessage(newest.accountId, other);
  return other ? { detail: loaded.data, error: loaded.error } : { detail: newest, error: null };
}
