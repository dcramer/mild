import { z } from 'zod';
import { storedHtml } from '../../../../queries/messages.ts';
import { frameNote, mailDocument } from '../../../../mail-html.ts';
import { frame } from '../../../route.ts';

export default frame({
  path: '/api/message/html',
  query: z.object({ id: z.string().default('') }),
  run: async ({ db }, scope, { id }) => {
    const html = await storedHtml(db, scope, id);
    return html === null ? { status: 404, html: frameNote('Sift does not hold this message’s HTML.') } : { status: 200, html: mailDocument(html) };
  },
});
