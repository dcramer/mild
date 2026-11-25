import { z } from 'zod';
import { messageDetail } from '../../../queries/messages.ts';
import { MessageDetail } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';

export default read({
  path: '/api/message',
  /** `account`: the mailbox the message is in, where the page knows. Unlike `?mailbox=`, it narrows nothing else read. */
  query: z.object({ id: z.string().default(''), account: z.string().default('') }),
  reply: MessageDetail,
  run: async ({ db }, scope, { id, account }) => {
    const detail = await messageDetail(db, scope, id, account);
    return detail ? ok(detail) : missing('No such message');
  },
});
