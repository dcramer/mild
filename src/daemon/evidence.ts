import type { DatabaseSync } from 'node:sqlite';
import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import { cachedCorrespondent, rememberCorrespondent, senderHistory } from '../store/senders.ts';
import { deriveFacts } from '../triage/facts.ts';
import type { Evidence } from '../triage/stages/model.ts';
import type { MessageFacts } from '../triage/types.ts';

export interface EvidenceSources {
  db: DatabaseSync;
  /** For the message body. */
  api: Pick<GmailApi, 'getBodyText'>;
  /** For "has the owner written to this sender". Only read from here. */
  mailbox: Pick<Mailbox, 'hasSentTo'>;
  now?: () => number;
}

/**
 * Collect what the model is shown about one message. Each lookup that fails becomes "unknown" instead
 * of failing the message; the model stage treats unknown correspondence as a reason for caution.
 */
export async function gatherEvidence(sources: EvidenceSources, facts: MessageFacts): Promise<Evidence> {
  const { db } = sources;
  const now = (sources.now ?? Date.now)();

  let body: string | null = null;
  try {
    body = await sources.api.getBodyText(facts.messageId);
  } catch {
    body = null;
  }

  let userHasWritten: boolean | null = cachedCorrespondent(db, facts.accountId, facts.from.address, now) ?? null;
  if (userHasWritten === null) {
    try {
      userHasWritten = await sources.mailbox.hasSentTo(facts.from.address);
      rememberCorrespondent(db, facts.accountId, facts.from.address, userHasWritten, now);
    } catch {
      userHasWritten = null;
    }
  }

  return { facts, known: deriveFacts(facts), body, sender: { ...senderHistory(db, facts.accountId, facts.from.address), userHasWritten } };
}
