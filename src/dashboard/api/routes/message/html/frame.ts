import { z } from 'zod';
import { recordedMessage } from '../../../../queries/messages.ts';
import { frameNote, mailDocument } from '../../../../mail-html.ts';
import { frame } from '../../../route.ts';

export default frame({
  path: '/api/message/html',
  query: z.object({ account: z.string().default(''), id: z.string().default('') }),
  run: async ({ db, controls }, scope, { account, id }) => {
    if (!(await recordedMessage(db, scope, account, id))) return { status: 404, html: frameNote('There is no such message here.') };
    if (!controls) return { status: 404, html: frameNote('This dashboard cannot reach Gmail.') };
    const html = await controls.messageHtml(db, account, id);
    return html === null ? { status: 404, html: frameNote('This message has no HTML, or is no longer in Gmail.') } : { status: 200, html: mailDocument(html) };
  },
});
