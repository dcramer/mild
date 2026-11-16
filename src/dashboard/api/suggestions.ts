import { type FeedbackInput, applyFeedback } from '../../learn/feedback.ts';
import { listAccounts } from '../../store/accounts.ts';
import { resolveProposal } from '../../store/proposals.ts';
import { listSuggestions, suggestionDetail } from '../queries/suggestions.ts';
import { LABEL_ID, type Read, type Write, missing, named, ok, ownerOf, str } from './route.ts';

const SCOPES = new Set(['label', 'sender', 'domain', 'subject', 'once']);

/** Check an answer to a suggestion field by field. Null if it is not well formed. */
function parseFeedback(body: Record<string, unknown>): FeedbackInput | null {
  const { accountId, sender, label, disposition, scope, contains, decisionId, messageId, unsubscribe, when } = body;
  if (typeof accountId !== 'string' || typeof sender !== 'string') return null;
  if (label !== undefined && (typeof label !== 'string' || !LABEL_ID.test(label))) return null;
  if (typeof scope !== 'string' || !SCOPES.has(scope)) return null;
  if (disposition !== undefined && disposition !== 'keep' && disposition !== 'archive' && disposition !== 'spam') return null;
  // An answer says what the mail is, what should happen to it, or both.
  if (label === undefined && disposition === undefined) return null;
  if (label === undefined && (scope === 'label' || when !== undefined)) return null;
  if (contains !== undefined && (typeof contains !== 'string' || contains.length > 200)) return null;
  if (scope === 'subject' && (typeof contains !== 'string' || contains.trim() === '')) return null;
  if (decisionId !== undefined && (typeof decisionId !== 'number' || !Number.isInteger(decisionId))) return null;
  if (messageId !== undefined && !str(messageId)) return null;
  if (unsubscribe !== undefined && typeof unsubscribe !== 'boolean') return null;
  if (when !== undefined && (typeof when !== 'string' || when.length > 200)) return null;
  return {
    accountId,
    sender,
    ...(typeof label === 'string' ? { label } : {}),
    scope: scope as FeedbackInput['scope'],
    ...(disposition === undefined ? {} : { disposition }),
    ...(typeof contains === 'string' ? { contains } : {}),
    ...(decisionId === undefined ? {} : { decisionId }),
    ...(messageId === undefined ? {} : { messageId }),
    ...(unsubscribe ? { unsubscribe } : {}),
    ...(typeof when === 'string' && when.trim() !== '' ? { when } : {}),
  };
}

export const reads: Read[] = [
  { path: '/api/suggestions', run: ({ db }, scope, query) => ok(listSuggestions(db, scope, { includeKept: query.get('kept') === '1' })) },
  {
    path: '/api/suggestion',
    run: ({ db }, scope, query) => {
      const detail = suggestionDetail(db, scope, query.get('account') ?? '', query.get('sender') ?? '');
      return detail ? ok(detail) : missing('No such mailbox');
    },
  },
];

export const writes: Write[] = [
  {
    path: '/api/feedback',
    touches: named,
    run: async ({ db, controls, now }, body) => {
      const input = parseFeedback(body);
      if (!input) return null;
      const result = applyFeedback(db, { ...input, mode: controls?.settings().act ? 'act' : 'observe' }, now());
      if (result.corrected === null || !controls) return { ...result, fixed: null };
      // The answer is saved whatever happens next; a mailbox that cannot be put right is reported, not hidden.
      try {
        const undone = await controls.putBack(input.accountId, result.corrected);
        return { ...result, fixed: undone ? 'What sift did to this message in Gmail has been taken back.' : null };
      } catch (error) {
        return {
          ...result,
          fixed: `The answer is saved, but the message could not be put back in Gmail: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  },
  {
    path: '/api/suggestions/rejudge',
    touches: named,
    run: async ({ db, controls }, body) => {
      const { accountId } = body;
      if (!str(accountId) || !listAccounts(db).some((a) => a.id === accountId)) return null;
      if (!controls) throw new Error('This dashboard cannot run the model.');
      return await controls.rejudge(accountId);
    },
  },
  {
    path: '/api/proposals',
    touches: ownerOf('proposals'),
    run: ({ db, now }, body) => {
      const { id, accept } = body;
      if (typeof id !== 'number' || !Number.isInteger(id) || typeof accept !== 'boolean') return null;
      if (!resolveProposal(db, id, accept, now())) throw new Error('That proposal is no longer open.');
      return { ok: true };
    },
  },
];
