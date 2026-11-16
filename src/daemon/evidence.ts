import type { DatabaseSync } from 'node:sqlite';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import type { MessageContent } from '../gmail/body.ts';
import { recordFacts } from '../store/messages.ts';
import { cachedCorrespondent, rememberCorrespondent, senderHistory } from '../store/senders.ts';
import { type ThreadFacts, deriveFacts, threadFacts } from '../triage/facts.ts';
import type { Evidence } from '../triage/stages/model.ts';
import type { MessageFacts } from '../triage/types.ts';

export interface EvidenceSources {
  db: DatabaseSync;
  /** For the message body. */
  api: Pick<GmailApi, 'getContent' | 'getThread'>;
  /** For "has the owner written to this sender". Only read from here. */
  mailbox: Pick<Mailbox, 'hasSentTo'>;
  now?: () => number;
}

/**
 * Collect what the model is shown about one message. Reading the whole message and, for a reply, its
 * thread's labels adds to the message's recorded facts; no other message's content is read. Each lookup that fails becomes "unknown" instead
 * of failing the message; the model stage treats unknown correspondence as a reason for caution.
 */
export async function gatherEvidence(sources: EvidenceSources, facts: MessageFacts): Promise<Evidence> {
  const { db } = sources;

  let content: MessageContent | null = null;
  try {
    content = await sources.api.getContent(facts.messageId);
  } catch {
    content = null;
  }
  let thread: ThreadFacts | null = null;
  if (deriveFacts(facts).isReply) {
    try {
      thread = threadFacts((await sources.api.getThread(facts.threadId)) ?? [], facts.messageId);
    } catch {
      thread = null;
    }
  }
  const known = deriveFacts(facts, { ...content?.facts, ...thread });
  if (content || thread) recordFacts(db, facts.accountId, facts.messageId, known);

  const userHasWritten = await ownerHasWritten(sources, facts);
  return { facts, known, body: content?.text ?? null, sender: { ...senderHistory(db, facts.accountId, facts.from.address), userHasWritten } };
}

/** Whether the owner has ever written to the sender: the cached answer, or one search of sent mail, remembered. Null if that failed. */
export async function ownerHasWritten(sources: Pick<EvidenceSources, 'db' | 'mailbox' | 'now'>, facts: MessageFacts): Promise<boolean | null> {
  const { db } = sources;
  const now = (sources.now ?? Date.now)();
  const cached = cachedCorrespondent(db, facts.accountId, facts.from.address, now);
  if (cached !== undefined) return cached;
  try {
    const written = await sources.mailbox.hasSentTo(facts.from.address);
    rememberCorrespondent(db, facts.accountId, facts.from.address, written, now);
    return written;
  } catch {
    return null;
  }
}
