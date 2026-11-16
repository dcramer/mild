import { listChanges, listDecisions, retryDecision } from '../queries/decisions.ts';
import { messageDetail } from '../queries/messages.ts';
import { summarize } from '../queries/summary.ts';
import { BAD_DAYS, type Read, type Write, daysOf, missing, ok, ownerOf } from './route.ts';

export const reads: Read[] = [
  {
    path: '/api/summary',
    run: async ({ db, now }, scope, query) => {
      const days = daysOf(query);
      return days === null ? BAD_DAYS : ok(await summarize(db, scope, days, now()));
    },
  },
  {
    path: '/api/decisions',
    run: async ({ db, now }, scope, query) => {
      const days = daysOf(query);
      if (days === null) return BAD_DAYS;
      const text = (name: string) => query.get(name) || undefined;
      const stage = text('stage');
      const disposition = text('disposition');
      const status = text('status');
      const search = text('q');
      return ok(
        await listDecisions(
          db,
          scope,
          {
            days,
            ...(stage ? { stage } : {}),
            ...(disposition ? { disposition } : {}),
            ...(status ? { status } : {}),
            ...(search ? { search } : {}),
            limit: Number(query.get('limit') ?? 50) || 50,
            offset: Number(query.get('offset') ?? 0) || 0,
          },
          now(),
        ),
      );
    },
  },
  {
    path: '/api/message',
    run: async ({ db }, scope, query) => {
      const detail = await messageDetail(db, scope, query.get('account') ?? '', query.get('id') ?? '');
      return detail ? ok(detail) : missing('No such message');
    },
  },
  { path: '/api/changes', run: async ({ db }, scope) => ok({ changes: await listChanges(db, scope, 200) }) },
];

export const writes: Write[] = [
  {
    path: '/api/undo',
    touches: ownerOf('actions'),
    run: async ({ controls }, body) => {
      if (typeof body['id'] !== 'number' || !Number.isInteger(body['id'])) return null;
      if (!controls) throw new Error('This dashboard cannot undo changes.');
      return { message: await controls.undo(body['id']) };
    },
  },
  {
    path: '/api/decisions/retry',
    touches: ownerOf('decisions'),
    run: async ({ db, controls }, body, scope) => {
      if (typeof body['id'] !== 'number' || !Number.isInteger(body['id'])) return null;
      const result = await retryDecision(db, scope, body['id']);
      if (!result.retried) throw new Error('That change did not fail, so there is nothing to try again.');
      controls?.checkNow();
      return result;
    },
  },
];
