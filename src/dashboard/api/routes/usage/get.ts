import { z } from 'zod';
import { usage } from '../../../queries/usage.ts';
import { Usage } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({ path: '/api/usage', query: z.object({}), reply: Usage, run: async ({ db, now }, scope) => ok(await usage(db, scope, now())) });
