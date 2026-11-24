import { z } from 'zod';
import { messageDetail } from '../../../queries/messages.ts';
import { MessagesAhead } from '../../../types.ts';
import { ok, read } from '../../route.ts';

/** As many as Inbox reads ahead (`READ_AHEAD`, web/src/views/inbox.tsx), with room to grow. */
const AT_MOST = 30;

/** Messages read ahead of a press that opens one, in one call rather than one a row. One the person cannot read is left out. */
export default read({
  path: '/api/messages',
  query: z.object({
    ids: z
      .string()
      .max(AT_MOST * 40)
      .default('')
      .transform((value) => value.split(',').filter((id) => id !== ''))
      .pipe(z.array(z.string()).max(AT_MOST)),
  }),
  reply: MessagesAhead,
  run: async ({ db }, scope, { ids }) => {
    const messages = [];
    for (const id of ids) {
      const detail = await messageDetail(db, scope, id);
      if (detail) messages.push(detail);
    }
    return ok({ messages });
  },
});
