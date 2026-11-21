import { z } from 'zod';
import { syncPage } from '../../../queries/sync.ts';
import { SyncPage } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({
  path: '/api/sync',
  query: z.object({ since: z.string().max(1000).optional() }),
  reply: SyncPage,
  run: async ({ db }, scope, { since }) => ok(await syncPage(db, scope, since)),
});
