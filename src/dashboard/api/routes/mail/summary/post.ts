import { z } from 'zod';
import { preferences } from '../../../../../store/preferences.ts';
import { MailSummary } from '../../../../types.ts';
import { named, write } from '../../../route.ts';
import { Refusal } from '../../../../../refusal.ts';

/** What one of the person's conversations says, recorded already or asked of their model now. */
export default write({
  path: '/api/mail/summary',
  body: z.strictObject({ accountId: z.string(), threadId: z.string().min(1).max(200) }),
  reply: MailSummary,
  touches: named,
  run: async ({ db, controls }, request) => {
    if (!(await preferences(db)).mail) throw new Refusal('Turn Inbox on first.');
    if (!controls) throw new Refusal('This dashboard cannot run the model.');
    return await controls.summarize(db, request);
  },
});
