import { z } from 'zod';
import { Refusal } from '../../../../../refusal.ts';
import { triedToSend } from '../../../../../store/actions.ts';
import { removeDraft } from '../../../../../store/drafts.ts';
import { reportError } from '../../../../../telemetry.ts';
import { refuseMissing } from '../../../../../store/uploads.ts';
import { replyTo } from '../../../../queries/reply.ts';
import { mailboxOf } from '../../../../queries/messages.ts';
import { SendRequest } from '../../../../types.ts';
import { named, write } from '../../../route.ts';

export default write({
  path: '/api/mail/send',
  body: SendRequest,
  // Its text and a forward's quote may be long: 200,000 characters, each up to a few bytes as JSON writes it.
  largest: 1_000_000,
  reply: z.object({ id: z.string(), threadId: z.string() }),
  touches: named,
  run: async ({ db, controls }, { accountId, id, from, to, cc, bcc, text, uploads, draft, ...about }, scope) => {
    if (!controls) throw new Refusal('This dashboard cannot send mail.');
    // A try before this one took its files with it, or still holds them.
    if (!(await triedToSend(db, id))) await refuseMissing(db, uploads);
    const mail = { from, to, cc, bcc, text };
    // Gone, its draft goes too, here and in Gmail's Drafts. A draft Gmail kept is not a reason to say it did not send.
    const sent = async (went: { id: string; threadId: string }) => {
      const gone = draft ? await removeDraft(db, draft) : null;
      if (gone?.gmailId) await controls.dropDraft(db, { id: draft!, accountId: gone.accountId, gmailId: gone.gmailId }).catch(reportError);
      return went;
    };
    if (!('replyTo' in about)) {
      const { subject, forwarding } = about;
      // A forward carries files only from a message of the same mailbox.
      if (forwarding && (await mailboxOf(db, scope, forwarding.messageId)) !== accountId) return null;
      return await sent(await controls.send(db, { accountId, id, mail: { ...mail, subject }, uploads, ...(forwarding ? { forwarding } : {}) }));
    }
    const answered = await replyTo(db, scope, accountId, about.replyTo.messageId);
    if (!answered) return null;
    const { threadId, ...thread } = answered;
    const { forwarding } = about;
    if (forwarding && forwarding.messageId !== about.replyTo.messageId) return null;
    // A subject of its own is a conversation of its own, as Gmail makes it: References alone do not hold it in the thread.
    const own = about.subject?.trim() ? about.subject : null;
    return await sent(
      await controls.send(db, {
        accountId,
        id,
        ...(own ? {} : { threadId }),
        mail: { ...mail, ...thread, ...(own ? { subject: own } : {}) },
        uploads,
        ...(forwarding ? { forwarding } : {}),
      }),
    );
  },
});
