import { predatingGuidelines } from '../../learn/redecide.ts';
import { lastSyncedAt, listAccounts } from '../../store/accounts.ts';
import { MAX_LABELS } from '../../store/labels.ts';
import { preferences, setGuidelines, setModel } from '../../store/preferences.ts';
import { listLabelSummaries } from '../queries/labels.ts';
import { type Scope, sees } from '../scope.ts';
import type { ManageState } from '../types.ts';
import { type Context, type Read, type Write, ok, str } from './route.ts';

/** Everything the Settings screen shows, for the mailboxes in scope. */
async function manageState({ db, controls }: Context, scope: Scope): Promise<ManageState> {
  const accounts = (await listAccounts(db)).filter((a) => sees(scope, a.id));
  const own = await preferences(db);
  const changedAt = own.guidelinesChangedAt;
  const activity = controls?.activity() ?? { sorting: false, lastPassAt: null, problems: [], expired: [] };
  return {
    owner: scope.owner,
    settings: controls?.settings() ?? { act: false, interval: 60, fewShot: true, examplesKeepDays: null },
    model: { chosen: own.model, ...(controls ? await controls.modelSignIns(db) : { choices: [], signedIn: [], pending: null }) },
    guidelines: own.guidelines,
    activity: {
      ...activity,
      // Each problem starts with the address it is about.
      problems: activity.problems.filter((line) => accounts.some((a) => line.startsWith(`${a.email}: `))),
      expired: activity.expired.filter((email) => accounts.some((a) => a.email === email)),
    },
    accounts: await Promise.all(accounts.map(async (a) => ({ id: a.id, email: a.email, lastSyncedAt: await lastSyncedAt(db, a.id) }))),
    labels: Object.fromEntries(await Promise.all(accounts.map(async (a) => [a.id, await listLabelSummaries(db, scope, a.id)] as const))),
    labelLimit: MAX_LABELS,
    predateGuidelines: Object.fromEntries(
      await Promise.all(accounts.map(async (a) => [a.id, changedAt === null ? 0 : (await predatingGuidelines(db, changedAt, a.id)).length] as const)),
    ),
  };
}

const install = () => 'install' as const;
const self = () => 'self' as const;

export const reads: Read[] = [
  { path: '/api/manage', run: async (ctx, scope) => ok(await manageState(ctx, scope)) },
  {
    path: '/api/models',
    // A provider that cannot be reached is said beside an empty list, not as a failed request.
    run: async ({ db, controls }) => {
      try {
        return ok(controls ? await controls.models(db) : { models: [], recommended: {} });
      } catch (error) {
        return ok({ models: [], recommended: {}, error: error instanceof Error ? error.message : String(error) });
      }
    },
  },
];

export const writes: Write[] = [
  {
    path: '/api/settings',
    touches: install,
    run: ({ controls }, body) => {
      const { act, interval, fewShot, examplesKeepDays: keep } = body;
      if (keep !== undefined && keep !== null && (typeof keep !== 'number' || !Number.isInteger(keep) || keep < 1 || keep > 36_500)) return null;
      if (act !== undefined && typeof act !== 'boolean') return null;
      if (fewShot !== undefined && typeof fewShot !== 'boolean') return null;
      if (interval !== undefined && (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 5 || interval > 86_400)) return null;
      if (!controls) throw new Error('This dashboard cannot change settings.');
      controls.saveSettings({
        ...(act === undefined ? {} : { act }),
        ...(interval === undefined ? {} : { interval }),
        ...(fewShot === undefined ? {} : { fewShot }),
        ...(keep === undefined ? {} : { examplesKeepDays: keep }),
      });
      return { settings: controls.settings() };
    },
  },
  {
    path: '/api/guidelines',
    touches: self,
    run: async ({ db, now }, body) => {
      if (typeof body['text'] !== 'string' || body['text'].length > 8000) return null;
      await setGuidelines(db, body['text'], now());
      return { ok: true };
    },
  },
  {
    path: '/api/model',
    touches: self,
    run: async ({ db, controls }, body) => {
      const { model } = body;
      if (model !== null && (!str(model) || !/^[^/\s]+\/\S+$/.test(model))) return null;
      await setModel(db, model);
      controls?.checkNow();
      return { ok: true };
    },
  },
  {
    path: '/api/model/chatgpt',
    touches: self,
    run: async ({ db, controls }) => {
      if (!controls) throw new Error('This dashboard cannot sign in to a model.');
      return await controls.signInChatGPT(db);
    },
  },
  {
    path: '/api/model/key',
    touches: self,
    run: async ({ db, controls }, body) => {
      const { provider, key } = body;
      if (!str(provider, 40) || !str(key, 500)) return null;
      if (!controls) throw new Error('This dashboard cannot sign in to a model.');
      await controls.saveModelKey(db, provider, key.trim());
      return { ok: true };
    },
  },
  {
    path: '/api/model/signout',
    touches: self,
    run: async ({ db, controls }, body) => {
      if (!str(body['provider'], 40)) return null;
      if (!controls) throw new Error('This dashboard cannot sign out of a model.');
      await controls.signOutModel(db, body['provider']);
      return { ok: true };
    },
  },
  {
    path: '/api/backfill',
    touches: install,
    run: async ({ controls }, body) => {
      const days = body['days'];
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 30) return null;
      if (!controls) throw new Error('This dashboard cannot pull in mail.');
      const added = await controls.backfill(days);
      controls.checkNow();
      return { added };
    },
  },
  {
    path: '/api/check',
    touches: () => 'anyone',
    run: ({ controls }) => {
      if (!controls) throw new Error('Nothing is sorting mail from this dashboard.');
      controls.checkNow();
      return { ok: true };
    },
  },
];
