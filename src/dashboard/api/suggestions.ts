import { z } from 'zod';
import { type FeedbackInput, applyFeedback } from '../../learn/feedback.ts';
import { resolveProposal } from '../../store/proposals.ts';
import { proposals } from '../../store/query.ts';
import { listSuggestions, suggestionDetail } from '../queries/suggestions.ts';
import { FACT_FILTER_KEYS, FeedbackReply, FeedbackRequest, SuggestionDetail, Suggestions } from '../types.ts';
import { type Read, type Write, done, flag, id, missing, named, ok, ownerOf, read, write } from './route.ts';

export const reads: Read[] = [
  read({
    path: '/api/suggestions',
    query: z.object({ kept: flag, fact: z.enum(FACT_FILTER_KEYS).optional() }),
    reply: Suggestions,
    run: async ({ db }, scope, { kept, fact }) => ok(await listSuggestions(db, scope, { includeKept: kept !== undefined, ...(fact ? { fact } : {}) })),
  }),
  read({
    path: '/api/suggestion',
    query: z.object({ account: z.string().default(''), sender: z.string().default('') }),
    reply: SuggestionDetail,
    run: async ({ db }, scope, { account, sender }) => {
      const detail = await suggestionDetail(db, scope, account, sender);
      return detail ? ok(detail) : missing('No such mailbox');
    },
  }),
];

export const writes: Write[] = [
  write({
    path: '/api/feedback',
    body: FeedbackRequest,
    reply: FeedbackReply,
    touches: named,
    run: async ({ db, controls, now }, { unsubscribe, when, ...answer }) => {
      const input: FeedbackInput = {
        ...answer,
        ...(unsubscribe ? { unsubscribe } : {}),
        ...(when !== undefined && when.trim() !== '' ? { when } : {}),
      };
      // An answer pressed here is carried out on its message whether or not they have sift on.
      const result = await applyFeedback(db, { ...input, carryOut: true }, now());
      if (result.corrected === null || !controls) {
        if (result.carrying > 0) await controls?.checkNow(db);
        return { ...result, fixed: null, notFixed: null };
      }
      // The answer is saved whatever happens next; a mailbox that cannot be put right is reported, not hidden.
      try {
        const undone = await controls.putBack(db, input.accountId, result.corrected);
        return { ...result, fixed: undone ? 'What sift did to this message in Gmail has been taken back.' : null, notFixed: null };
      } catch (error) {
        return { ...result, fixed: null, notFixed: error instanceof Error ? error.message : String(error) };
      }
    },
  }),
  write({
    path: '/api/proposals',
    body: z.strictObject({ id, accept: z.boolean() }),
    reply: done,
    touches: ownerOf(proposals),
    run: async ({ db, now }, { id, accept }) => {
      if (!(await resolveProposal(db, id, accept, now()))) throw new Error('That proposal is no longer open.');
      return { ok: true as const };
    },
  }),
];
