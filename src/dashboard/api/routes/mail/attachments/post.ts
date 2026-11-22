import { z } from 'zod';
import { Refusal } from '../../../../../refusal.ts';
import { MessageAttachment } from '../../../../types.ts';
import { accountId, named, text, write } from '../../../route.ts';

/**
 * A message's files, for a forward to carry. A write, since mail Inbox kept before Mild kept these is read from Gmail once
 * for them, and they are kept.
 */
export default write({
  path: '/api/mail/attachments',
  body: z.strictObject({ accountId, messageId: text() }),
  reply: z.object({ attachments: z.array(MessageAttachment) }),
  touches: named,
  run: async ({ db, controls }, message) => {
    if (!controls) throw new Refusal('This dashboard cannot read mail.');
    return { attachments: await controls.attachments(db, message) };
  },
});
