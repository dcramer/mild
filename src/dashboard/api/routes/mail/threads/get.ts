import { z } from 'zod';
import { listThreads } from '../../../../queries/mail.ts';
import { MAIL_VIEWS, MailThreads } from '../../../../types.ts';
import { flag, ok, read } from '../../../route.ts';

export default read({
  path: '/api/mail/threads',
  query: z.object({
    view: z.enum(MAIL_VIEWS).default('all'),
    label: z.string().max(40).optional(),
    q: z.string().max(200).optional(),
    unread: flag,
    before: z.string().max(200).optional(),
  }),
  reply: MailThreads,
  run: async ({ db }, scope, { unread, ...query }) => ok(await listThreads(db, scope, { ...query, unread: unread !== undefined })),
});
