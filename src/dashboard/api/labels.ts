import { z } from 'zod';
import { listAccounts } from '../../store/accounts.ts';
import { addLabel, updateLabel } from '../../store/labels.ts';
import { type Write, accountId, fromOutcome, named, outcome, redecide, text, write } from './route.ts';

const DESCRIPTION = z.string().max(600);

export const writes: Write[] = [
  write({
    path: '/api/labels',
    body: z.strictObject({
      accountId,
      id: text(40),
      name: text(60).optional(),
      description: DESCRIPTION.optional(),
      disposition: outcome.optional(),
      markRead: z.boolean().optional(),
      unsubscribe: z.boolean().optional(),
    }),
    reply: z.object({ ok: z.literal(true), redecided: z.number() }),
    touches: named,
    run: async ({ db, now }, { accountId, id, disposition, ...rest }) => {
      const change: Parameters<typeof updateLabel>[3] = { ...rest, ...(disposition === undefined ? {} : fromOutcome(disposition)) };
      if (!(await updateLabel(db, accountId, id, change, now()))) throw new Error(`There is no label "${id}".`);
      return { ok: true as const, redecided: await redecide(db, now, accountId) };
    },
  }),
  write({
    path: '/api/labels/add',
    body: z.strictObject({
      accountId,
      name: text(60),
      description: DESCRIPTION,
      disposition: outcome,
      markRead: z.boolean().optional(),
      unsubscribe: z.boolean().optional(),
    }),
    reply: z.object({ id: z.string() }),
    touches: named,
    run: async ({ db, now }, { accountId, name, description, disposition, markRead, unsubscribe }) => {
      if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
      const label = { name, description, ...fromOutcome(disposition), ...(markRead ? { markRead } : {}), ...(unsubscribe ? { unsubscribe } : {}) };
      return { id: (await addLabel(db, accountId, label, now())).id };
    },
  }),
];
