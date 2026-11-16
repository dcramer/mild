import { z } from 'zod';
import { done, install, write } from '../../route.ts';

export default write({
  path: '/api/backfill',
  body: z.strictObject({ days: z.int().min(1).max(30) }),
  reply: done,
  touches: install,
  run: async ({ controls }, { days }) => {
    if (!controls) throw new Error('This dashboard cannot pull in mail.');
    await controls.backfill(days);
    return { ok: true as const };
  },
});
