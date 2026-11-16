import { z } from 'zod';
import { lastSyncedAt, listAccounts } from '../../store/accounts.ts';
import { MAX_LABELS } from '../../store/labels.ts';
import { preferences, setActive, setModel } from '../../store/preferences.ts';
import { listLabelSummaries } from '../queries/labels.ts';
import { type Scope, sees } from '../scope.ts';
import { ManageState, Models, SignInCode } from '../types.ts';
import { type Context, type Read, type Write, done, ok, read, text, write } from './route.ts';

/** Everything the Settings screen shows, for the mailboxes in scope. */
async function manageState({ db, controls }: Context, scope: Scope): Promise<ManageState> {
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
    accounts: await Promise.all(accounts.map(async (a) => ({ id: a.id, email: a.email, lastSyncedAt: await lastSyncedAt(db, a.id) }))),
    labels: Object.fromEntries(await Promise.all(accounts.map(async (a) => [a.id, await listLabelSummaries(db, scope, a.id)] as const))),
    labelLimit: MAX_LABELS,
  };
}

const install = () => 'install' as const;
const self = () => 'self' as const;
const nothing = z.strictObject({});
const provider = text(40);

export const reads: Read[] = [
  read({ path: '/api/manage', query: z.object({}), reply: ManageState, run: async (ctx, scope) => ok(await manageState(ctx, scope)) }),
  read({
    path: '/api/models',
    query: z.object({}),
    reply: Models,
    // A provider that cannot be reached is said beside an empty list, not as a failed request.
    run: async ({ db, controls }) => {
      try {
        return ok(controls ? await controls.models(db) : { models: [], recommended: {} });
      } catch (error) {
        return ok({ models: [], recommended: {}, error: error instanceof Error ? error.message : String(error) });
      }
    },
  }),
];

export const writes: Write[] = [
  write({
    path: '/api/active',
    body: z.strictObject({ active: z.boolean() }),
    reply: done,
    touches: self,
    run: async ({ db, controls }, { active }) => {
      await setActive(db, active);
      controls?.checkNow();
      return { ok: true as const };
    },
  }),
  write({
    path: '/api/model',
    body: z.strictObject({
      model: text()
        .regex(/^[^/\s]+\/\S+$/)
        .nullable(),
    }),
    reply: done,
    touches: self,
    run: async ({ db, controls }, { model }) => {
      await setModel(db, model);
      controls?.checkNow();
      return { ok: true as const };
    },
  }),
  write({
    path: '/api/model/chatgpt',
    body: nothing,
    reply: SignInCode,
    touches: self,
    run: async ({ db, controls }) => {
      if (!controls) throw new Error('This dashboard cannot sign in to a model.');
      return await controls.signInChatGPT(db);
    },
  }),
  write({
    path: '/api/model/chatgpt/finish',
    body: z.strictObject({ address: text(4000) }),
    reply: done,
    touches: self,
    run: async ({ db, controls }, { address }) => {
      if (!controls) throw new Error('This dashboard cannot sign in to a model.');
      await controls.finishChatGPT(db, address.trim());
      return { ok: true as const };
    },
  }),
  write({
    path: '/api/model/key',
    body: z.strictObject({ provider, key: text(500) }),
    reply: done,
    touches: self,
    run: async ({ db, controls }, { provider, key }) => {
      if (!controls) throw new Error('This dashboard cannot sign in to a model.');
      await controls.saveModelKey(db, provider, key.trim());
      return { ok: true as const };
    },
  }),
  write({
    path: '/api/model/signout',
    body: z.strictObject({ provider }),
    reply: done,
    touches: self,
    run: async ({ db, controls }, { provider }) => {
      if (!controls) throw new Error('This dashboard cannot sign out of a model.');
      await controls.signOutModel(db, provider);
      return { ok: true as const };
    },
  }),
  write({
    path: '/api/backfill',
    body: z.strictObject({ days: z.int().min(1).max(30) }),
    reply: z.object({ added: z.number() }),
    touches: install,
    run: async ({ controls }, { days }) => {
      if (!controls) throw new Error('This dashboard cannot pull in mail.');
      const added = await controls.backfill(days);
      controls.checkNow();
      return { added };
    },
  }),
  write({
    path: '/api/check',
    body: nothing,
    reply: done,
    touches: () => 'anyone',
    run: ({ controls }) => {
      if (!controls) throw new Error('Only the dashboard is running here, so there is nothing to check with.');
      controls.checkNow();
      return { ok: true as const };
    },
  }),
];
