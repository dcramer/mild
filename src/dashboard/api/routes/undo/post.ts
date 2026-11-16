import { z } from 'zod';
import { actions } from '../../../../store/query.ts';
import { getAction } from '../../../../store/actions.ts';
import { id, ownerOf, write } from '../../route.ts';

export default write({
  path: '/api/undo',
  body: z.strictObject({ id }),
  reply: z.object({ message: z.string().nullable() }),
  touches: ownerOf(actions),
  run: async ({ db, controls }, { id }) => {
    if (!controls) throw new Error('This dashboard cannot undo changes.');
    if (!(await getAction(db, id))) throw new Error(`There is no change #${id}.`);
    return { message: await controls.undo(db, id) };
  },
});
