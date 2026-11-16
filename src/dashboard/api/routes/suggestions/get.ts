import { z } from 'zod';
import { listSuggestions } from '../../../queries/suggestions.ts';
import { FACT_FILTER_KEYS, Suggestions } from '../../../types.ts';
import { flag, ok, read } from '../../route.ts';

export default read({
  path: '/api/suggestions',
  query: z.object({ kept: flag, fact: z.enum(FACT_FILTER_KEYS).optional() }),
  reply: Suggestions,
  run: async ({ db }, scope, { kept, fact }) => ok(await listSuggestions(db, scope, { includeKept: kept !== undefined, ...(fact ? { fact } : {}) })),
});
