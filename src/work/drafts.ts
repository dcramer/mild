import { dropGmailDraft } from '../actions/drafts.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import { type Attached, sendMail } from '../actions/send.ts';
import type { GmailApi } from '../gmail/api.ts';
import { plain } from '../plain.ts';
import { Refusal } from '../refusal.ts';
import { failSchedule, removeDraft, scheduledBy } from '../store/drafts.ts';
import { answering } from '../store/reply.ts';
import type { Sql } from '../store/sql.ts';
import { removeUploads, uploaded } from '../store/uploads.ts';
import { reportError } from '../telemetry.ts';
import { attachmentsOf, forwardedFiles } from './attachments.ts';

/**
 * Send what was scheduled to go by `now`, as the press of Send would have: through `sendMail`, under the Message-ID the
 * composer made as it was scheduled, so a pass tried again sends it once. One Gmail no longer has in its Drafts was sent or
 * deleted there, and goes from Mild unsent. One that cannot go until the person puts it right (Inbox turned off, sending
 * not allowed, an address wrong) is a draft again, saying why. Any other failure is tried again next pass.
 */
export async function sendScheduled(
  db: Sql,
  gmail: { api: Pick<GmailApi, 'getContent' | 'getAttachment'>; mailbox: Mailbox },
  accountId: string,
  now: number,
): Promise<number> {
  let sent = 0;
  for (const draft of await scheduledBy(db, accountId, now)) {
    const writing = plain(draft.writing);
    try {
      if (draft.gmailId && !(await gmail.mailbox.hasDraft(draft.gmailId))) {
        await removeDraft(db, draft.id);
        continue;
      }
      if (!writing.id) throw new Refusal('It has no Message-ID. Schedule it again.');
      const answered = writing.of.kind === 'reply' ? await answering(db, accountId, writing.of.messageId) : null;
      if (writing.of.kind === 'reply' && !answered) throw new Refusal('The message it answers is no longer here.');
      const wrong = [...writing.to, ...writing.cc, ...writing.bcc].find((r) => r.wrong);
      if (wrong) throw new Refusal(`“${wrong.address}” is not an address.`);
      const parties = (list: typeof writing.to) => list.map(({ address, name }) => (name ? { address, name } : { address }));
      const forwarded = writing.of.kind === 'forward' || (writing.of.kind === 'reply' && writing.withFiles) ? writing.of.messageId : null;
      const attach = async (): Promise<Attached[]> => {
        const parts = forwarded
          ? (await attachmentsOf(db, gmail.api, accountId, forwarded)).map((a) => a.part).filter((p) => !writing.dropped.includes(p))
          : [];
        return [
          ...(await uploaded(
            db,
            writing.files.map((f) => f.id),
          )),
          ...(forwarded ? await forwardedFiles(db, gmail.api, accountId, forwarded, parts) : []),
        ];
      };
      await sendMail(
        { db, mailbox: gmail.mailbox, now: () => now },
        {
          accountId,
          id: writing.id,
          ...(answered && !(writing.editSubject && writing.subject.trim()) ? { threadId: answered.threadId } : {}),
          mail: {
            from: { address: writing.from || accountId },
            to: parties(writing.to),
            cc: parties(writing.cc),
            bcc: parties(writing.bcc),
            subject: (answered && !writing.editSubject ? answered.subject : writing.subject.trim()) || (answered?.subject ?? ''),
            text: writing.text,
            ...(answered?.inReplyTo ? { inReplyTo: answered.inReplyTo } : {}),
            ...(answered ? { references: answered.references } : {}),
          },
          attach,
        },
      );
      const gone = await removeDraft(db, draft.id);
      await removeUploads(
        db,
        writing.files.map((f) => f.id),
      );
      if (gone?.gmailId) await dropGmailDraft(db, gmail.mailbox, { id: draft.id, accountId, gmailId: gone.gmailId }, now).catch(reportError);
      sent++;
    } catch (error) {
      if (error instanceof Refusal) await failSchedule(db, draft.id, error.message);
      else reportError(error);
    }
  }
  return sent;
}
