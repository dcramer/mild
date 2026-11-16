import { predatingGuidelines } from '../../learn/redecide.ts';
import { listAccounts } from '../../store/accounts.ts';
import { listLabelSummaries } from '../queries/labels.ts';
import { type Scope, sees } from '../scope.ts';
import type { ManageState } from '../types.ts';
import { type Context, type Read, type Write, ok, str } from './route.ts';

/** Everything the Settings screen shows, for the mailboxes in scope. */
function manageState({ db, controls }: Context, scope: Scope): ManageState {
  const accounts = listAccounts(db).filter((a) => sees(scope, a.id));
  const synced = db.prepare('SELECT last_synced_at AS at FROM accounts WHERE id = ?');
  const changedAt = controls?.guidelinesChangedAt() ?? null;
  const activity = controls?.activity() ?? { sorting: false, lastPassAt: null, problems: [], expired: [] };
  return {
    owner: scope.owner,
    settings: controls?.settings() ?? { act: false, interval: 60, model: null, fewShot: true, examplesKeepDays: null },
    // The guidelines are the owner's own words about their mail.
    guidelines: scope.owner ? (controls?.guidelines() ?? '') : '',
    activity: {
      ...activity,
      // Each problem starts with the address it is about.
      problems: activity.problems.filter((line) => accounts.some((a) => line.startsWith(`${a.email}: `))),
      expired: activity.expired.filter((email) => accounts.some((a) => a.email === email)),
    },
    accounts: accounts.map((a) => ({ id: a.id, email: a.email, lastSyncedAt: (synced.get(a.id) as { at: number | null } | undefined)?.at ?? null })),
    labels: Object.fromEntries(accounts.map((a) => [a.id, listLabelSummaries(db, scope, a.id)])),
    predateGuidelines: Object.fromEntries(accounts.map((a) => [a.id, changedAt === null ? 0 : predatingGuidelines(db, changedAt, a.id).length])),
  };
}

const install = () => 'install' as const;

export const reads: Read[] = [
  { path: '/api/manage', run: (ctx, scope) => ok(manageState(ctx, scope)) },
  {
    path: '/api/models',
    // A provider that cannot be reached is said beside an empty list, not as a failed request.
    run: async ({ controls }) => {
      try {
        return ok({ models: controls ? await controls.models() : [] });
      } catch (error) {
        return ok({ models: [], error: error instanceof Error ? error.message : String(error) });
      }
    },
  },
];

export const writes: Write[] = [
  {
    path: '/api/settings',
    touches: install,
    run: ({ controls }, body) => {
      const { act, interval, model, fewShot, examplesKeepDays: keep } = body;
      if (keep !== undefined && keep !== null && (typeof keep !== 'number' || !Number.isInteger(keep) || keep < 1 || keep > 36_500)) return null;
      if (act !== undefined && typeof act !== 'boolean') return null;
      if (fewShot !== undefined && typeof fewShot !== 'boolean') return null;
      if (interval !== undefined && (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 5 || interval > 86_400)) return null;
      if (model !== undefined && model !== null && (!str(model) || !/^[^/\s]+\/\S+$/.test(model))) return null;
      if (!controls) throw new Error('This dashboard cannot change settings.');
      controls.saveSettings({
        ...(act === undefined ? {} : { act }),
        ...(interval === undefined ? {} : { interval }),
        ...(model === undefined ? {} : { model }),
        ...(fewShot === undefined ? {} : { fewShot }),
        ...(keep === undefined ? {} : { examplesKeepDays: keep }),
      });
      return { settings: controls.settings() };
    },
  },
  {
    path: '/api/guidelines',
    touches: install,
    run: ({ controls }, body) => {
      if (typeof body['text'] !== 'string' || body['text'].length > 8000) return null;
      if (!controls) throw new Error('This dashboard cannot change the guidelines.');
      controls.saveGuidelines(body['text']);
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
