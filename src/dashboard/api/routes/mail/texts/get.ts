import { z } from 'zod';
import { texts } from '../../../../queries/sync.ts';
import { MailTexts } from '../../../../types.ts';
import { ok, read } from '../../../route.ts';

/** `accountId/messageId`: an address holds no slash, and Gmail's ids are letters and digits. */
const MESSAGE = /^([^/\s]{1,320})\/([\w-]{1,200})$/;

export default read({
  path: '/api/mail/texts',
  query: z.object({
    ids: z
      .string()
      .max(30_000)
      .transform((value) => value.split(',').filter((id) => id !== ''))
      .pipe(z.array(z.string().regex(MESSAGE)).min(1).max(50))
      .transform((ids) => ids.map((id) => ({ accountId: MESSAGE.exec(id)![1]!, messageId: MESSAGE.exec(id)![2]! }))),
  }),
  reply: MailTexts,
  run: async ({ db }, scope, { ids }) => ok(await texts(db, scope, ids)),
});
