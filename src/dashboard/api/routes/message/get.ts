import { z } from 'zod';
import { messageDetail } from '../../../queries/messages.ts';
import { MessageDetail } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';

export default read({
  path: '/api/message',
  query: z.object({ account: z.string().default(''), id: z.string().default('') }),
  reply: MessageDetail,
  run: async ({ db, controls }, scope, { account, id }) => {
    const detail = await messageDetail(db, scope, account, id);
    if (!detail) return missing('No such message');
    // Which parts it has is known only once it has been read whole, and mail a rule placed never was. Read it
    // now, once; if Gmail cannot be reached, it is shown as text and read the next time it is opened.
    if (detail.hasHtml !== null || !controls) return ok(detail);
    const read = await controls.readMessage(db, account, id).then(
      () => true,
      () => false,
    );
    return ok(read ? ((await messageDetail(db, scope, account, id)) ?? detail) : detail);
  },
});
