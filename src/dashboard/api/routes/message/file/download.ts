import { z } from 'zod';
import { Refusal } from '../../../../../refusal.ts';
import { fileIn } from '../../../../queries/messages.ts';
import { download } from '../../../route.ts';

/** One of a message's files, fetched from Gmail each time (20 units): Mild keeps only their names. */
export default download({
  path: '/api/message/file',
  /** `account`: the mailbox the message is in (`/api/message`). */
  query: z.object({ id: z.string().default(''), part: z.string().default(''), account: z.string().default('') }),
  run: async ({ db, controls }, scope, { id, part, account }) => {
    const accountId = await fileIn(db, scope, id, part, account);
    if (accountId === null) return null;
    if (!controls) throw new Refusal('This dashboard cannot read mail.');
    return await controls.file(db, { accountId, messageId: id, part });
  },
});
