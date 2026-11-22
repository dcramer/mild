import { and, eq, messages } from './query.ts';
import type { Sql } from './sql.ts';
import { openEnvelope } from './content.ts';
import { plain } from '../plain.ts';

/** A Message-ID as `buildMessage` (src/actions/send.ts) will put it in a header. One it would refuse is left out of a reply. */
const MESSAGE_ID = /^<[\x21-\x3b\x3d\x3f-\x7e]+@[\x21-\x3b\x3d\x3f-\x7e]+>$/;
/** The References a reply carries: the first message of the conversation and the newest before it, as RFC 5322 asks. */
const REFERENCES = 20;

/**
 * What a reply to a recorded message takes from it: its conversation, its subject with "Re: ", and the Message-IDs it
 * follows (`In-Reply-To`, `References`). Null when the mailbox has no record of it.
 */
export async function answering(
  db: Sql,
  accountId: string,
  messageId: string,
): Promise<{ threadId: string; subject: string; inReplyTo?: string; references: string[] } | null> {
  const [stored] = await db
    .select({ threadId: messages.threadId, headers: messages.headers })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  if (!stored) return null;
  const { subject, headers } = plain(openEnvelope(db, accountId, messageId, stored));
  const own = headers['message-id']?.trim();
  const before = (headers['references'] ?? '').split(/\s+/).filter((id) => MESSAGE_ID.test(id));
  const inReplyTo = own && MESSAGE_ID.test(own) ? own : undefined;
  const chain = inReplyTo ? [...before.filter((id) => id !== inReplyTo), inReplyTo] : before;
  const references = chain.length > REFERENCES ? [chain[0]!, ...chain.slice(-(REFERENCES - 1))] : chain;
  return {
    threadId: stored.threadId,
    subject: /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`,
    ...(inReplyTo ? { inReplyTo } : {}),
    references,
  };
}
