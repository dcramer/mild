import { type FeedbackInput, applyFeedback } from '../../../../learn/feedback.ts';
import { FeedbackReply, FeedbackRequest } from '../../../types.ts';
import { named, write } from '../../route.ts';

export default write({
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
      return { ...result, fixed: undone ? 'What Sift did to this message in Gmail has been taken back.' : null, notFixed: null };
    } catch (error) {
      return { ...result, fixed: null, notFixed: error instanceof Error ? error.message : String(error) };
    }
  },
});
