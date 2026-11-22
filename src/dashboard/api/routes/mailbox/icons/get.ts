import { z } from 'zod';
import { MailboxIcons } from '../../../../types.ts';
import { ok, read } from '../../../route.ts';

export default read({
  path: '/api/mailbox/icons',
  query: z.object({}),
  reply: MailboxIcons,
  run: async ({ controls }, scope) => {
    const domains = [...new Set(scope.accounts.map((account) => account.split('@')[1]!))];
    return ok({ icons: controls ? await controls.mailboxIcons(domains) : Object.fromEntries(domains.map((domain) => [domain, null])) });
  },
});
