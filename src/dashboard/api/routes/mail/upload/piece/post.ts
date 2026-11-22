import { z } from 'zod';
import { Refusal } from '../../../../../../refusal.ts';
import { PIECE_BYTES, addPiece } from '../../../../../../store/uploads.ts';
import { done, self, text, write } from '../../../../route.ts';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** One piece of a file being uploaded, as base64. Safe to send again. */
export default write({
  path: '/api/mail/upload/piece',
  body: z.strictObject({
    id: text(64),
    piece: z.int().nonnegative(),
    data: z
      .string()
      .max(Math.ceil(PIECE_BYTES / 3) * 4)
      .regex(BASE64),
  }),
  largest: Math.ceil(PIECE_BYTES / 3) * 4 + 1_000,
  reply: done,
  touches: self,
  run: async ({ db }, { id, piece, data }) => {
    if (!(await addPiece(db, id, piece, Buffer.from(data, 'base64')))) throw new Refusal('That file is no longer attached. Attach it again.');
    return { ok: true as const };
  },
});
