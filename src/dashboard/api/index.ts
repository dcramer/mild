import type { Frame, Read, Write } from './route.ts';
import accountDeleteWrite from './routes/account/delete/post.ts';
import activeWrite from './routes/active/post.ts';
import backfillWrite from './routes/backfill/post.ts';
import changesRead from './routes/changes/get.ts';
import checkWrite from './routes/check/post.ts';
import decisionsRead from './routes/decisions/get.ts';
import decisionsRetryWrite from './routes/decisions/retry/post.ts';
import domainRead from './routes/domain/get.ts';
import evalRead from './routes/eval/get.ts';
import evalsRead from './routes/evals/get.ts';
import evalsRunWrite from './routes/evals/run/post.ts';
import examplesDeleteAllWrite from './routes/examples/delete-all/post.ts';
import examplesDeleteWrite from './routes/examples/delete/post.ts';
import examplesRead from './routes/examples/get.ts';
import feedbackWrite from './routes/feedback/post.ts';
import labelsAddWrite from './routes/labels/add/post.ts';
import labelsWrite from './routes/labels/post.ts';
import mailboxRemoveWrite from './routes/mailbox/remove/post.ts';
import manageRead from './routes/manage/get.ts';
import messageRead from './routes/message/get.ts';
import messageHtmlFrame from './routes/message/html/frame.ts';
import modelChatgptFinishWrite from './routes/model/chatgpt/finish/post.ts';
import modelChatgptWrite from './routes/model/chatgpt/post.ts';
import modelKeyWrite from './routes/model/key/post.ts';
import modelWrite from './routes/model/post.ts';
import modelSignoutWrite from './routes/model/signout/post.ts';
import modelsRead from './routes/models/get.ts';
import proposalsWrite from './routes/proposals/post.ts';
import rulesFilterWrite from './routes/rules/filter/post.ts';
import rulesRead from './routes/rules/get.ts';
import rulesWrite from './routes/rules/post.ts';
import rulesRemoveWrite from './routes/rules/remove/post.ts';
import senderRead from './routes/sender/get.ts';
import standingClearWrite from './routes/standing/clear/post.ts';
import suggestionRead from './routes/suggestion/get.ts';
import suggestionsRead from './routes/suggestions/get.ts';
import summaryRead from './routes/summary/get.ts';
import undoWrite from './routes/undo/post.ts';
import unjudgedRead from './routes/unjudged/get.ts';
import unjudgedRetryAllWrite from './routes/unjudged/retry-all/post.ts';
import unjudgedRetryWrite from './routes/unjudged/retry/post.ts';

/**
 * Every route under `/api/`, each its own module at `routes/<path>/<get|post|frame>.ts`. The server applies
 * the session, the scope and the write checks to all of them.
 */
export const READS: readonly Read[] = [
  changesRead,
  decisionsRead,
  domainRead,
  evalRead,
  evalsRead,
  examplesRead,
  manageRead,
  messageRead,
  modelsRead,
  rulesRead,
  senderRead,
  suggestionRead,
  suggestionsRead,
  summaryRead,
  unjudgedRead,
];
export const WRITES: readonly Write[] = [
  accountDeleteWrite,
  activeWrite,
  backfillWrite,
  checkWrite,
  decisionsRetryWrite,
  evalsRunWrite,
  examplesDeleteWrite,
  examplesDeleteAllWrite,
  feedbackWrite,
  labelsWrite,
  labelsAddWrite,
  mailboxRemoveWrite,
  modelWrite,
  modelChatgptWrite,
  modelChatgptFinishWrite,
  modelKeyWrite,
  modelSignoutWrite,
  proposalsWrite,
  rulesWrite,
  rulesFilterWrite,
  rulesRemoveWrite,
  standingClearWrite,
  undoWrite,
  unjudgedRetryWrite,
  unjudgedRetryAllWrite,
];
export const FRAMES: readonly Frame[] = [messageHtmlFrame];
