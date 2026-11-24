'use client';
import type { MessageDetail } from '@/lib/api/endpoints.ts';
import type { Writing } from '@/lib/compose.ts';
import { reveal } from '@/lib/reveal.ts';
import { Arrived, Failure, Loading } from '@/system';
import { InlineComposer } from '@/views/composer/index.tsx';
import { useConversationMessage } from './conversation.ts';

export type Answer = Exclude<Writing, { kind: 'new' }>;

/** The reply box, at the foot of the conversation, on the message it answers, which it names when that is not the newest. */
export function Answering({ what, newest, onClose }: { what: Answer; newest: MessageDetail; onClose: () => void }) {
  const { detail, error } = useConversationMessage(what.messageId, newest);
  if (!detail) return error ? <Failure>{error}</Failure> : <Loading rows={3} />;
  const who = reveal(detail.fromName) ?? reveal(detail.fromAddress);
  const about =
    detail.messageId === newest.messageId ? undefined : (
      <>
        {what.kind === 'forward' ? `Forwarding ${who}’s message, ` : `Replying to ${who}, `}
        <Arrived at={detail.receivedAt} />
      </>
    );
  return <InlineComposer what={what} message={detail} about={about} onClose={onClose} />;
}
