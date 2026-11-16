import { z } from 'zod';
import { actions, decisions } from '../../store/query.ts';
import { getAction } from '../../store/actions.ts';
import { listChanges, listDecisions, retryDecision } from '../queries/decisions.ts';
import { messageDetail } from '../queries/messages.ts';
import { summarize } from '../queries/summary.ts';
import { ChangeRow, DecisionPage, MessageDetail, Summary } from '../types.ts';
import { type Read, type Write, days, id, missing, ok, ownerOf, read, write } from './route.ts';

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
      limit: z.coerce.number().int().positive().catch(50),
      offset: z.coerce.number().int().nonnegative().catch(0),
    }),
    reply: DecisionPage,
    run: async ({ db, now }, scope, { days, stage, disposition, status, q, limit, offset }) =>
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
];

export const writes: Write[] = [
  write({
    path: '/api/undo',
    body: z.strictObject({ id }),
    reply: z.object({ message: z.string() }),
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
      controls?.checkNow();
      return result;
    },
  }),
];
