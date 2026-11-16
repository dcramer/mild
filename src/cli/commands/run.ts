import { parseArgs } from 'node:util';
import { unsubscribe } from '../../actions/unsubscribe.ts';
import { loadConfig } from '../../config.ts';
import type { Activity } from '../../dashboard/controls.ts';
import { type PassResult, createWake, runLoop, runOnce } from '../../daemon/run.ts';
import { createGmailApi } from '../../gmail/api.ts';
import { clientFor, hasClientSecrets, loadClientSecrets } from '../../gmail/auth.ts';
import { createGmailMailbox } from '../../gmail/mailbox.ts';
import { type Account, listAccounts } from '../../store/accounts.ts';
import { openDb } from '../../store/db.ts';
import { paint, ui } from '../ui.ts';
import { openModelTier, buildControls } from '../controls.ts';
import { checkSecrets } from '../secrets-check.ts';
import { serveDashboard, portOption } from '../serve.ts';

export async function run(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      act: { type: 'boolean', default: false },
      observe: { type: 'boolean', default: false },
      once: { type: 'boolean', default: false },
      interval: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-dashboard': { type: 'boolean', default: false },
      // Set by `sift dev`.
      dev: { type: 'boolean', default: false },
    },
  });
  if (values.act && values.observe) throw new Error('Choose one of --act and --observe.');
  const intervalFlag = values.interval === undefined ? undefined : Number(values.interval);
  if (intervalFlag !== undefined && (!Number.isFinite(intervalFlag) || intervalFlag < 5)) throw new Error('--interval must be at least 5 seconds.');
  const config = loadConfig();
  const secrets = checkSecrets(config, true);

  const db = openDb(config.dbPath);
  try {
    const log = (line: string) => ui.plain(`${paint.dim(new Date().toLocaleTimeString(undefined, { hour12: false }))}  ${line}`);

    // Settings are read again before every pass, so changes made in the dashboard or sift.toml apply
    // without a restart. A flag given here wins for as long as this process runs.
    const tiers = new Map<string, Awaited<ReturnType<typeof openModelTier>> | null>();
    let announced = '';
    const next = async () => {
      const { settings } = loadConfig();
      const act = values.observe ? false : values.act || settings.act;
      const spec = settings.model;
      if (spec && !tiers.has(spec)) {
        try {
          tiers.set(spec, await openModelTier(config, spec));
        } catch (error) {
          tiers.set(spec, null);
          ui.fail(error instanceof Error ? error.message : String(error));
        }
      }
      const tier = spec ? tiers.get(spec) : null;
      const state = `${act ? 'acting' : 'observing'} · ${spec ?? 'no model'}`;
      if (announced !== '' && announced !== state) log(`Now ${state}`);
      announced = state;
      return {
        act,
        heuristics: settings.heuristics,
        ...(tier ? { model: { ...tier, fewShot: settings.fewShot } } : {}),
        unsubscribe: (accountId: string, messageId: string) => unsubscribe({ db }, accountId, messageId),
        ...(settings.examplesKeepDays ? { examplesKeepDays: settings.examplesKeepDays } : {}),
        connect: (account: Account) => {
          const client = clientFor(config, loadClientSecrets(config), account.email);
          return { api: createGmailApi(client), mailbox: createGmailMailbox(client) };
        },
        log,
        intervalMs: (intervalFlag ?? settings.interval) * 1000,
        ...(settings.retentionDays === undefined ? {} : { retentionDays: settings.retentionDays }),
      };
    };

    const first = await next();
    ui.heading(first.act ? 'acting' : 'observing', `${config.settings.model ?? 'no model'} · every ${first.intervalMs / 1000}s`);
    secrets();
    if (!hasClientSecrets(config)) ui.warn(`No Google client yet. Run ${paint.cmd('sift init')}.`);
    else if (listAccounts(db).length === 0) ui.warn('No Gmail account yet. Open the dashboard and sign in with Google.');
    else if (!first.act) ui.info('Gmail is not changed while sift is observing. Switch it in the dashboard, under Settings.');

    if (values.once) {
      ui.blank();
      const results = await runOnce(db, first);
      if (results.some((r) => r.error)) process.exitCode = 1;
      return;
    }

    // One process keeps sift online: the same one that sorts mail serves the dashboard.
    const wake = createWake();
    const activity: Activity = { sorting: true, lastPassAt: null, problems: [], expired: [] };
    const port = portOption(values.port);
    const stopDashboard = values['no-dashboard']
      ? () => {}
      : await serveDashboard(config, db, {
          controls: buildControls(config, db, { wake, activity }),
          ...(values.dev ? { dev: true } : {}),
          ...(port === undefined ? {} : { port }),
          ...(values.host ? { host: values.host } : {}),
        });
    ui.blank();
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    try {
      await runLoop(db, next, {
        signal: stop.signal,
        wake,
        onPass: (results: PassResult[]) => {
          activity.lastPassAt = Date.now();
          activity.problems = results.flatMap((r) => (r.error ? [`${r.email}: ${r.error}`] : []));
          activity.expired = results.filter((r) => r.expired).map((r) => r.email);
        },
      });
    } finally {
      stopDashboard();
    }
  } finally {
    db.close();
  }
}
