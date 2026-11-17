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
    // What Sift did to a message it now has a new answer for is taken back first: the review mark on mail
    // it asked about while on, and its change to a corrected one. putBack starts the pass that carries the answer out.
    const back = [...result.asked, ...(result.corrected === null ? [] : [result.corrected])];
    if (back.length === 0 || !controls) {
      if (result.carrying > 0) await controls?.checkNow(db);
      return { ...result, fixed: null, notFixed: null };
    }
    // The answer is saved whatever happens next; a mailbox that cannot be put right is reported, not hidden.
    try {
      let undone = false;
      for (const messageId of back) undone = (await controls.putBack(db, input.accountId, messageId)) && messageId === result.corrected ? true : undone;
      return { ...result, fixed: undone ? 'What Sift did to this message in Gmail has been taken back.' : null, notFixed: null };
    } catch (error) {
      return { ...result, fixed: null, notFixed: error instanceof Error ? error.message : String(error) };
    }
  },
});
