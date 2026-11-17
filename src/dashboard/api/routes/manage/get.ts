import { z } from 'zod';
import { lastSyncedAt, listAccounts } from '../../../../store/accounts.ts';
import { inboxProgress } from '../../../../store/inbox.ts';
import { MAX_LABELS } from '../../../../store/labels.ts';
import { preferences } from '../../../../store/preferences.ts';
import { listLabelSummaries } from '../../../queries/labels.ts';
import { type Scope, sees } from '../../../scope.ts';
import { ManageState } from '../../../types.ts';
import { type Context, ok, read } from '../../route.ts';

/** Everything the Settings screen shows, for the mailboxes in scope. */
async function manageState({ db, controls, person }: Context, scope: Scope): Promise<ManageState> {
  const accounts = (await listAccounts(db)).filter((a) => sees(scope, a.id));
  const own = await preferences(db);
  const activity = controls ? await controls.activity(accounts.map((a) => a.id)) : { running: false, lastPassAt: null, problems: [], expired: [] };
  return {
    owner: scope.owner,
    active: own.active,
    model: { chosen: own.model, ...(controls ? await controls.modelSignIns(db) : { choices: [], signedIn: [], pending: null }) },
    activity: {
      ...activity,
      // Only these mailboxes were asked about; checked again here, since a leak would be someone else's mail.
      problems: activity.problems.filter((line) => accounts.some((a) => line.startsWith(`${a.email}: `))),
      expired: activity.expired.filter((email) => accounts.some((a) => a.email === email)),
    },
    accounts: await Promise.all(
      accounts.map(async (a) => ({ id: a.id, email: a.email, lastSyncedAt: await lastSyncedAt(db, a.id), primary: a.id === person?.primary })),
    ),
    labels: Object.fromEntries(await Promise.all(accounts.map(async (a) => [a.id, await listLabelSummaries(db, scope, a.id)] as const))),
    labelLimit: MAX_LABELS,
    inbox: await inboxProgress(
      db,
      accounts.map((a) => a.id),
    ),
  };
}

export default read({ path: '/api/manage', query: z.object({}), reply: ManageState, run: async (ctx, scope) => ok(await manageState(ctx, scope)) });
