import type { Sql } from '../store/sql.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import type { MessageContent } from '../gmail/body.ts';
import { mailboxAliases } from '../store/accounts.ts';
import { recordFacts, storedFacts } from '../store/messages.ts';
import { cachedCorrespondent, domainFacts, rememberCorrespondent, senderFacts, senderHistory } from '../store/senders.ts';
import { type ThreadFacts, deriveFacts, threadFacts } from '../triage/facts.ts';
import type { Evidence } from '../triage/stages/model.ts';
import type { MessageFacts } from '../triage/types.ts';

export interface EvidenceSources {
  db: Sql;
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
  const known = deriveFacts(facts, { ...content?.facts, ...thread }, await mailboxAliases(db, facts.accountId));
  if (content || thread) await recordFacts(db, facts.accountId, facts.messageId, known);

  const userHasWritten = await ownerHasWritten(sources, facts);
  const now = (sources.now ?? Date.now)();
  const sender = await senderFacts(db, facts.accountId, facts.from.address, now);
  const domain = await domainFacts(db, facts.accountId, facts.from.domain, now);
  return {
    facts,
    known,
    body: content?.text ?? null,
    sender: {
      ...(await senderHistory(db, facts.accountId, facts.from.address)),
      userHasWritten,
      standing: { standing: sender.standing, why: sender.why },
      pastLabels: sender.labels,
      firstSeenAt: sender.firstSeenAt,
    },
    ...(domain
      ? { domain: { messages: domain.messages, senders: domain.senders, standing: domain.standing, why: domain.why, pastLabels: domain.labels } }
      : {}),
  };
}

/**
 * Read one message whole and record what that shows about it (attachments, what its HTML holds), keeping
 * what is known of its thread. For a message no pass read whole, such as one a rule placed, opened in the
 * dashboard. Nothing of its content is kept.
 */
export async function readWhole(db: Sql, api: Pick<GmailApi, 'getContent'>, facts: MessageFacts): Promise<void> {
  const content = await api.getContent(facts.messageId);
  if (!content) return;
  const known = await storedFacts(db, facts.accountId, facts.messageId);
  const thread =
    known?.earlierInThread === undefined || known.ownerInThread === undefined
      ? {}
      : { earlierInThread: known.earlierInThread, ownerInThread: known.ownerInThread };
  await recordFacts(db, facts.accountId, facts.messageId, deriveFacts(facts, { ...content.facts, ...thread }, await mailboxAliases(db, facts.accountId)));
}

/** Whether the owner has ever written to the sender: the cached answer, or one search of sent mail, remembered. Null if that failed. */
async function ownerHasWritten(sources: Pick<EvidenceSources, 'db' | 'mailbox' | 'now'>, facts: MessageFacts): Promise<boolean | null> {
  const { db } = sources;
  const now = (sources.now ?? Date.now)();
  const cached = await cachedCorrespondent(db, facts.accountId, facts.from.address, now);
  if (cached !== undefined) return cached;
  try {
    const written = await sources.mailbox.hasSentTo(facts.from.address);
    await rememberCorrespondent(db, facts.accountId, facts.from.address, written, now);
    return written;
  } catch {
    return null;
  }
}
