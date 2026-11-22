import type { Attached } from '../actions/send.ts';
import type { Attachment } from '../gmail/body.ts';
import type { GmailApi } from '../gmail/api.ts';
import { Refusal } from '../refusal.ts';
import { keepAttachments, keptAttachments } from '../store/kept.ts';
import { storedFacts } from '../store/messages.ts';
import type { Sql } from '../store/sql.ts';

type Reader = Pick<GmailApi, 'getContent' | 'getAttachment'>;

/** Read the message whole again for the files it lists now, and keep them. 60 units. */
async function relist(db: Sql, api: Reader, accountId: string, messageId: string): Promise<Attachment[]> {
  const list = (await api.getContent(messageId))?.attachments ?? [];
  await keepAttachments(db, accountId, messageId, list);
  return list;
}

/**
 * A message's files. Mail Inbox kept before Mild kept these is read from Gmail once for them, and they are kept from then
 * on. Mail Mild knows has none, or whose text Inbox does not keep, where they could not be kept, is not read.
 */
export async function attachmentsOf(db: Sql, api: Reader, accountId: string, messageId: string): Promise<Attachment[]> {
  const kept = await keptAttachments(db, accountId, messageId);
  if (kept !== null) return kept ?? [];
  const facts = await storedFacts(db, accountId, messageId);
  // Only mail Mild has recorded is asked for.
  if (!facts || facts.hasAttachments === false) return [];
  return await relist(db, api, accountId, messageId);
}

/**
 * The files of a message being forwarded, by their parts, fetched from Gmail (20 units each), which Mild never keeps. An id
 * Gmail no longer knows is read again with the message once (`relist`), in case its ids changed since it was kept.
 */
export async function forwardedFiles(db: Sql, api: Reader, accountId: string, messageId: string, parts: readonly string[]): Promise<Attached[]> {
  if (parts.length === 0) return [];
  let list = await attachmentsOf(db, api, accountId, messageId);
  let fresh = false;
  const files: Attached[] = [];
  for (const part of parts) {
    for (;;) {
      const file = list.find((a) => a.part === part);
      const data = file ? await api.getAttachment(messageId, file.gmailId) : null;
      if (file && data) {
        files.push({ name: file.name, type: file.type, data });
        break;
      }
      if (fresh) throw new Refusal(`${file?.name ?? 'A file'} is no longer in the message you are forwarding. Remove it to send.`);
      list = await relist(db, api, accountId, messageId);
      fresh = true;
    }
  }
  return files;
}
