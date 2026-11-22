import { z } from 'zod';
import { Refusal } from '../../../../../refusal.ts';
import { triedToSend } from '../../../../../store/actions.ts';
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
  run: async ({ db, controls }, { accountId, id, from, to, cc, bcc, text, uploads, ...about }, scope) => {
    if (!controls) throw new Refusal('This dashboard cannot send mail.');
    // A try before this one took its files with it, or still holds them.
    if (!(await triedToSend(db, id))) await refuseMissing(db, uploads);
    const mail = { from, to, cc, bcc, text };
    if ('subject' in about) {
      const { subject, forwarding } = about;
      // A forward carries files only from a message of the same mailbox.
      if (forwarding && (await mailboxOf(db, scope, forwarding.messageId)) !== accountId) return null;
      return await controls.send(db, { accountId, id, mail: { ...mail, subject }, uploads, ...(forwarding ? { forwarding } : {}) });
    }
    const answered = await replyTo(db, scope, accountId, about.replyTo.messageId);
    if (!answered) return null;
    const { threadId, ...thread } = answered;
    return await controls.send(db, { accountId, id, threadId, mail: { ...mail, ...thread }, uploads });
  },
});
