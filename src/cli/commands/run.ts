import { parseArgs } from 'node:util';
import { loadConfig } from '../../config.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { hasClientSecrets } from '../../gmail/auth.ts';
import { connectedAddresses, listUsers } from '../../store/accounts.ts';
import { preferences } from '../../store/preferences.ts';
import { openStore } from '../../store/store.ts';
import { openEphemeral } from '../../ephemeral/open.ts';
import { paint, ui } from '../ui.ts';
import { createSift } from '../../host/sift.ts';
import { checkSecrets } from '../secrets-check.ts';
import { nodeHost, portOption, serveDashboard } from '../serve.ts';

/** A minute: new mail is classified soon after it lands, and a quiet pass costs a history read per mailbox. */
const INTERVAL_MS = 60_000;

export async function run(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      once: { type: 'boolean', default: false },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-dashboard': { type: 'boolean', default: false },
      // Set by `sift dev`.
      dev: { type: 'boolean', default: false },
    },
  });
  const config = loadConfig();
  const store = await openStore(config);
  if (store.warning) ui.warn(store.warning);
  const ephemeral = await openEphemeral(config.settings.redisUrl);
  try {
    const secrets = await checkSecrets(config, store, true);
    const log = (line: string) => ui.plain(`${paint.dim(new Date().toLocaleTimeString(undefined, { hour12: false }))}  ${line}`);

    // Everything sift starts in the background, so stopping waits for it.
    const running = new Set<Promise<unknown>>();
    const background = (work: Promise<unknown>) => {
      const held: Promise<unknown> = work
        .catch((error: unknown) => log(`Could not finish: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => running.delete(held));
      running.add(held);
    };
    const port = portOption(values.port) ?? config.settings.dashboardPort;
    const sift = await createSift({ ...nodeHost(config, store, ephemeral, port, log), background });

    const users = await listUsers(store.central);
    const people = users.length;
    let on = 0;
    for (const user of users) if ((await preferences(await store.user(user.id))).active) on++;
    ui.heading(on === 0 ? 'off' : on === people ? 'on' : `on for ${on} of ${people}`);
    secrets();
    if (!hasClientSecrets(config)) ui.warn(`No Google client yet. Run ${paint.cmd('sift init')}.`);
    else if ((await connectedAddresses(store.central)).length === 0) ui.warn('No Gmail account yet. Open the dashboard and sign in with Google.');
    else if (on === 0) ui.info('Gmail is not changed while sift is off. Each person turns it on in the dashboard, under Settings.');

    if (values.once) {
      ui.blank();
      const results = await sift.tick();
      if (results.some((r) => r.error)) process.exitCode = 1;
      return;
    }

    // One process keeps sift online: the same one that classifies mail serves the dashboard.
    const stopDashboard = values['no-dashboard']
      ? () => {}
      : await serveDashboard(config, sift, { port, ...(values.dev ? { dev: true } : {}), ...(values.host ? { host: values.host } : {}) });
    ui.blank();
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    try {
      // Every minute, without waiting for the last tick: ticks that overlap skip work under way.
      while (!stop.signal.aborted) {
        background(sift.tick());
        await sleep(INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => {});
      }
    } finally {
      stopDashboard();
      await Promise.all(running);
    }
  } finally {
    await ephemeral.close();
    await store.close();
  }
}
