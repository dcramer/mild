import { z } from 'zod';
import { listAccounts } from '../../../../../store/accounts.ts';
import { REACH, startInboxRuns } from '../../../../../store/inbox.ts';
import { hasOwnLabels } from '../../../../../store/labels.ts';
import { preferences } from '../../../../../store/preferences.ts';
import { InboxReach } from '../../../../types.ts';
import { done, self, write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

export default write({
  path: '/api/inbox/start',
  body: z.strictObject({ reach: InboxReach }),
  reply: done,
  touches: self,
  run: async ({ db, controls, now }, { reach }) => {
    // Sift reads nothing from a mailbox without a label of the person's own.
    const mailboxes = [];
    for (const account of await listAccounts(db)) if (await hasOwnLabels(db, account.id)) mailboxes.push(account.id);
    const { active } = await preferences(db);
    if ((await startInboxRuns(db, mailboxes, { acts: active, most: REACH[reach], now: now() })) === 0)
      throw new Refusal('Sift is already going through your inbox.');
    await controls?.checkNow(db);
    return { ok: true as const };
  },
});
