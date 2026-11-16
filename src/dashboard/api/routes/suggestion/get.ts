import { z } from 'zod';
import { suggestionDetail } from '../../../queries/suggestions.ts';
import { SuggestionDetail } from '../../../types.ts';
import { missing, ok, read } from '../../route.ts';

export default read({
  path: '/api/suggestion',
  query: z.object({ account: z.string().default(''), sender: z.string().default('') }),
  reply: SuggestionDetail,
  run: async ({ db }, scope, { account, sender }) => {
    const detail = await suggestionDetail(db, scope, account, sender);
    return detail ? ok(detail) : missing('No such mailbox');
  },
});
