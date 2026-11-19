import { z } from 'zod';
import { messageDetail } from '../../../queries/messages.ts';
import { MessageDetail } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';

export default read({
  path: '/api/message',
  query: z.object({ id: z.string().default('') }),
  reply: MessageDetail,
  run: async ({ db }, scope, { id }) => {
    const detail = await messageDetail(db, scope, id);
    return detail ? ok(detail) : missing('No such message');
  },
});
