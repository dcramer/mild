'use client';
import { useMemo } from 'react';
import type { AnswerLabel } from '@/components/answer.tsx';
import type { Writer } from '@/components/mail.tsx';
import type { MailThread } from '@/lib/api/endpoints.ts';
import type { Copied } from '@/lib/copy.ts';
import { reveal } from '@/lib/reveal.ts';

/** A conversation as a row lists it: who wrote, revealed. */
export type Listed = Omit<MailThread, 'who'> & { who: readonly Writer[] };

/** The newest message, which the reader opens on. */
export const newest = (t: Listed) => ({ accountId: t.accountId, messageId: t.messageIds.at(-1)! });

/** A conversation the copy holds, as its row lists it: the person's own mailboxes as "me", the label by its name. */
function listedOf({ conversation: c, unread, newestAt }: Copied, mine: ReadonlySet<string>, names: ReadonlyMap<string, string>): Listed {
  const last = c.messages.at(-1)!;
  const writers = new Map<string, Writer>();
  for (const m of c.messages) {
    const address = reveal(m.fromAddress);
    if (mine.has(address)) writers.set('', { name: 'me', address: null });
    else if (!writers.has(address)) writers.set(address, { name: reveal(m.fromName) ?? address, address });
  }
  return {
    accountId: c.accountId,
    threadId: c.threadId,
    subject: last.subject,
    from: last.fromAddress,
    who: [...writers.values()],
    messageIds: c.messages.map((m) => m.messageId),
    unread,
    newestAt,
    place: 'inbox',
    preview: last.preview,
    thinks: c.thinks ? { ...c.thinks, labelName: (c.thinks.labelId && names.get(c.thinks.labelId)) ?? null } : null,
  };
}

/**
 * Each conversation as its row lists it, made once for each version of it the copy or the server gave: a row whose
 * conversation is the same object as last time gets the same props, and is not drawn again.
 */
export function useRows(manage: { labels: readonly AnswerLabel[]; accounts: readonly { email: string }[] } | null | undefined) {
  return useMemo(() => {
    const names = new Map((manage?.labels ?? []).map((l) => [l.id, l.name] as const));
    const mine = new Set((manage?.accounts ?? []).map((a) => a.email));
    const made = new WeakMap<object, Listed>();
    const rowOf = (row: Copied | MailThread): Listed => {
      let listed = made.get(row);
      if (!listed) {
        listed =
          'conversation' in row ? listedOf(row, mine, names) : { ...row, who: row.who.map((w) => ({ name: reveal(w.name), address: reveal(w.address) })) };
        made.set(row, listed);
      }
      return listed;
    };
    return { names, rowOf };
  }, [manage?.labels, manage?.accounts]);
}
