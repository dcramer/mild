import { z } from 'zod';
import { conversation } from '../../../../queries/mail.ts';
import { MailConversation } from '../../../../types.ts';
import { missing, ok, read } from '../../../route.ts';

export default read({
  path: '/api/mail/thread',
  /** `account`: the mailbox the conversation is in, where the page knows (`/api/message`). */
  query: z.object({ thread: z.string().default(''), account: z.string().default('') }),
  reply: MailConversation,
  run: async ({ db }, scope, { thread, account }) => {
    const found = await conversation(db, scope, thread, account);
    return found ? ok(found) : missing('No such conversation');
  },
});
