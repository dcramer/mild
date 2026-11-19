import { z } from 'zod';
import { suggestionDetail } from '../../../queries/suggestions.ts';
import { SuggestionDetail } from '../../../types.ts';
import { ok, read } from '../../route.ts';

export default read({
  path: '/api/suggestion',
  query: z.object({ sender: z.string().default('') }),
  reply: SuggestionDetail,
  run: async ({ db }, scope, { sender }) => ok(await suggestionDetail(db, scope, sender)),
});
