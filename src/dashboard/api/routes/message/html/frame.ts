import { z } from 'zod';
import { storedHtml } from '../../../../queries/messages.ts';
import { frameNote, mailDocument } from '../../../../mail-html.ts';
import { frame } from '../../../route.ts';

export default frame({
  path: '/api/message/html',
  /** `images`: the reader pressed Show images. */
  query: z.object({ id: z.string().default(''), images: z.literal('1').optional() }),
  run: async ({ db }, scope, { id, images }) => {
    const html = await storedHtml(db, scope, id);
    return html === null
      ? { status: 404, html: frameNote('Mild does not hold this message’s HTML.') }
      : { status: 200, html: mailDocument(html, images === '1'), images: images === '1' };
  },
});
