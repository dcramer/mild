import { z } from 'zod';
import { Models } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({
  path: '/api/models',
  query: z.object({}),
  reply: Models,
  // A provider that cannot be reached is said beside an empty list, not as a failed request.
  run: async ({ db, controls }) => {
    try {
      return ok(controls ? await controls.models(db) : { models: [], shortlist: {}, costs: {} });
    } catch (error) {
      return ok({ models: [], shortlist: {}, costs: {}, error: error instanceof Error ? error.message : String(error) });
    }
  },
});
