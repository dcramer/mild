import { listAccounts } from '../../store/accounts.ts';
import { addLabel, updateLabel } from '../../store/labels.ts';
import { type Write, fromOutcome, named, outcome, redecide, str } from './route.ts';

export const writes: Write[] = [
  {
    path: '/api/labels',
    touches: named,
    run: async ({ db, now }, body) => {
      const { accountId, id, name, description, disposition, markRead, unsubscribe } = body;
      if (!str(accountId) || !str(id, 40)) return null;
      if (name !== undefined && !str(name, 60)) return null;
      if (description !== undefined && (typeof description !== 'string' || description.length > 600)) return null;
      if (disposition !== undefined && !outcome(disposition)) return null;
      if (markRead !== undefined && typeof markRead !== 'boolean') return null;
      if (unsubscribe !== undefined && typeof unsubscribe !== 'boolean') return null;
      const change: Parameters<typeof updateLabel>[3] = {};
      if (name !== undefined) change.name = name;
      if (description !== undefined) change.description = description;
      if (disposition !== undefined) Object.assign(change, fromOutcome(disposition));
      if (markRead !== undefined) change.markRead = markRead;
      if (unsubscribe !== undefined) change.unsubscribe = unsubscribe;
      if (!(await updateLabel(db, accountId, id, change, now()))) throw new Error(`There is no label "${id}".`);
      return { ok: true, redecided: await redecide(db, now, accountId) };
    },
  },
  {
    path: '/api/labels/add',
    touches: named,
    run: async ({ db, now }, body) => {
      const { accountId, name, description, disposition, markRead, unsubscribe } = body;
      if (!str(accountId) || !str(name, 60) || typeof description !== 'string' || description.length > 600) return null;
      if (!outcome(disposition) || (markRead !== undefined && typeof markRead !== 'boolean')) return null;
      if (unsubscribe !== undefined && typeof unsubscribe !== 'boolean') return null;
      if (!(await listAccounts(db)).some((a) => a.id === accountId)) return null;
      return {
        id: (
          await addLabel(
            db,
            accountId,
            { name, description, ...fromOutcome(disposition), ...(markRead ? { markRead } : {}), ...(unsubscribe ? { unsubscribe } : {}) },
            now(),
          )
        ).id,
      };
    },
  },
];
