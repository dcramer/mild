import { mailBodies, messages, preferences } from './query.ts';
import type { Sql } from './sql.ts';
import { sealFacts, sealMessage, sealPart } from './content.ts';
import { deriveFacts } from '../triage/facts.ts';
import { envelopeOf } from '../triage/features.ts';
import { mailboxAliases } from './accounts.ts';

/**
 * Keep mail the person sent from Sift, so its conversation shows it: a record in `messages` with Gmail's labels for it,
 * decided already (it is theirs, not mail to triage), and what they wrote in `mail_bodies`. `headers` are the headers it
 * went with, names lowercased. Only while Inbox is on, under the same lock as `keepMailBodies`. Safe to repeat.
 */
export async function recordSent(
  db: Sql,
  accountId: string,
  sent: { id: string; threadId: string; labelIds: readonly string[]; headers: Record<string, string>; text: string; at: number },
): Promise<void> {
  const envelope = envelopeOf(sent.headers);
  if (!envelope) throw new Error('A sent message has no usable From');
  const aliases = await mailboxAliases(db, accountId);
  const message = { accountId, ...envelope, labelIds: [...sent.labelIds], headers: sent.headers };
  await db.transaction(async (tx) => {
    const [on] = await tx.select({ mail: preferences.mail }).from(preferences).for('share');
    if (!on?.mail) return;
    await tx
      .insert(messages)
      .values({
        accountId,
        id: sent.id,
        threadId: sent.threadId,
        receivedAt: sent.at,
        ...sealMessage(tx, accountId, sent.id, message),
        labelIds: [...sent.labelIds],
        syncedAt: sent.at,
        facts: sealFacts(deriveFacts(message, {}, aliases)),
        decided: true,
      })
      .onConflictDoNothing();
    await tx
      .insert(mailBodies)
      .values({ accountId, messageId: sent.id, bodyText: sealPart(tx, accountId, sent.id, 'text', sent.text)!, bodyHtml: null, fetchedAt: sent.at })
      .onConflictDoNothing();
  });
}
