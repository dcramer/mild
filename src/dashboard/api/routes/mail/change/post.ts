import { z } from 'zod';
import { MailChange } from '../../../../types.ts';
import { named, write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

export default write({
  path: '/api/mail/change',
  body: MailChange,
  /** The changes that landed, for Undo. */
  reply: z.object({ actions: z.array(z.number()) }),
  touches: named,
  run: async ({ db, controls }, { accountId, messageIds, change }) => {
    if (!controls) throw new Refusal('This dashboard cannot change mail.');
    return { actions: await controls.changeMail(db, accountId, messageIds, change) };
  },
});
