import { z } from 'zod';
import { listSuggestions } from '../../../queries/suggestions.ts';
import { FACT_FILTER_KEYS, Suggestions } from '../../../types.ts';
import { sees } from '../../../scope.ts';
import { flag, ok, read } from '../../route.ts';

export default read({
  path: '/api/suggestions',
  query: z.object({ kept: flag, fact: z.enum(FACT_FILTER_KEYS).optional() }),
  reply: Suggestions,
  run: async ({ db, controls }, scope, { kept, fact }) => {
    // Asked only about these mailboxes; checked again here, since what comes back is about someone else's otherwise.
    const pulling = controls ? (await controls.pullingIn(scope.accounts)).some((mailbox) => sees(scope, mailbox)) : false;
    return ok(await listSuggestions(db, scope, { includeKept: kept !== undefined, pullingIn: pulling, ...(fact ? { fact } : {}) }));
  },
});
