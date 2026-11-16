import { z } from 'zod';
import { actions, decisions } from '../../store/query.ts';
import { getAction } from '../../store/actions.ts';
import { listChanges, listDecisions, retryDecision } from '../queries/decisions.ts';
import { messageDetail, recordedMessage } from '../queries/messages.ts';
import { frameNote, mailDocument } from '../mail-html.ts';
import { listUnjudged } from '../queries/runs.ts';
import { putAllBackInQueue, putBackInQueue } from '../../store/runs.ts';
import { summarize } from '../queries/summary.ts';
import { ChangeRow, DecisionPage, MessageDetail, Summary, UnjudgedRow } from '../types.ts';
import { type Frame, type Read, type Write, accountId, days, frame, id, missing, named, ok, ownerOf, read, text, write } from './route.ts';

/** A filter left empty is no filter. */
const filter = z.string().optional();

export const reads: Read[] = [
  read({
    path: '/api/summary',
    query: z.object({ days }),
    reply: Summary,
    run: async ({ db, now }, scope, { days }) => ok(await summarize(db, scope, days, now())),
  }),
  read({
    path: '/api/decisions',
    query: z.object({
      days,
      stage: filter,
      disposition: filter,
      status: filter,
      q: filter,
      fact: filter,
      limit: z.coerce.number().int().positive().catch(50),
      offset: z.coerce.number().int().nonnegative().catch(0),
    }),
    reply: DecisionPage,
    run: async ({ db, now }, scope, { days, stage, disposition, status, q, fact, limit, offset }) =>
      ok(
        await listDecisions(
          db,
          scope,
          {
            days,
            ...(stage ? { stage } : {}),
            ...(disposition ? { disposition } : {}),
            ...(status ? { status } : {}),
            ...(q ? { search: q } : {}),
            ...(fact ? { fact } : {}),
            limit,
            offset,
          },
          now(),
        ),
      ),
  }),
  read({
    path: '/api/message',
    query: z.object({ account: z.string().default(''), id: z.string().default('') }),
    reply: MessageDetail,
    run: async ({ db }, scope, { account, id }) => {
      const detail = await messageDetail(db, scope, account, id);
      return detail ? ok(detail) : missing('No such message');
    },
  }),
  read({
    path: '/api/changes',
    query: z.object({}),
    reply: z.object({ changes: z.array(ChangeRow) }),
    run: async ({ db }, scope) => ok({ changes: await listChanges(db, scope, 200) }),
  }),
  read({
    path: '/api/unjudged',
    query: z.object({}),
    reply: z.object({ rows: z.array(UnjudgedRow) }),
    run: async ({ db }, scope) => ok({ rows: await listUnjudged(db, scope, 200) }),
  }),
];

export const frames: Frame[] = [
  frame({
    path: '/api/message/html',
    query: z.object({ account: z.string().default(''), id: z.string().default('') }),
    run: async ({ db, controls }, scope, { account, id }) => {
      if (!(await recordedMessage(db, scope, account, id))) return { status: 404, html: frameNote('There is no such message here.') };
      if (!controls) return { status: 404, html: frameNote('This dashboard cannot reach Gmail.') };
      const html = await controls.messageHtml(db, account, id);
      return html === null
        ? { status: 404, html: frameNote('This message has no HTML, or is no longer in Gmail.') }
        : { status: 200, html: mailDocument(html) };
    },
  }),
];

export const writes: Write[] = [
  write({
    path: '/api/undo',
    body: z.strictObject({ id }),
    reply: z.object({ message: z.string().nullable() }),
    touches: ownerOf(actions),
    run: async ({ db, controls }, { id }) => {
      if (!controls) throw new Error('This dashboard cannot undo changes.');
      if (!(await getAction(db, id))) throw new Error(`There is no change #${id}.`);
      return { message: await controls.undo(db, id) };
    },
  }),
  write({
    path: '/api/decisions/retry',
    body: z.strictObject({ id }),
    reply: z.object({ retried: z.boolean(), waiting: z.boolean() }),
    touches: ownerOf(decisions),
    run: async ({ db, controls }, { id }, scope) => {
      const result = await retryDecision(db, scope, id);
      if (!result.retried) throw new Error('That change did not fail, so there is nothing to try again.');
      await controls?.checkNow(db);
      return result;
    },
  }),
  write({
    path: '/api/unjudged/retry',
    body: z.strictObject({ accountId, messageId: text() }),
    reply: z.object({ ok: z.literal(true) }),
    touches: named,
    run: async ({ db, controls, now }, { accountId, messageId }) => {
      if (!(await putBackInQueue(db, accountId, messageId, now()))) throw new Error('That message is already waiting to be judged.');
      await controls?.checkNow(db);
      return { ok: true as const };
    },
  }),
  write({
    path: '/api/unjudged/retry-all',
    body: z.strictObject({}),
    reply: z.object({ retried: z.number() }),
    touches: () => 'self',
    run: async ({ db, controls, now }, _body, scope) => {
      const retried = await putAllBackInQueue(db, scope.accounts, now());
      if (retried === 0) throw new Error('Nothing the model failed on is left to retry.');
      await controls?.checkNow(db);
      return { retried };
    },
  }),
];
