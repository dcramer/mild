import { parseArgs } from 'node:util';
import { loadConfig } from '../../config.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { hasClientSecrets } from '../../gmail/auth.ts';
import { connectedAddresses, listUsers } from '../../store/accounts.ts';
import { preferences } from '../../store/preferences.ts';
import { openStore } from '../../store/store.ts';
import { paint, ui } from '../ui.ts';
import { checkSecrets } from '../secrets-check.ts';
import { cronSecret, sessionSecret } from '../session.ts';
import { signInAddresses, tailscaleName } from '../network.ts';
import { buildPage, startNext } from '../next.ts';
import { flushTelemetry, startTelemetry } from '../../telemetry.ts';

/** A minute: new mail is classified soon after it lands, and a quiet pass costs a history read per mailbox. */
const INTERVAL_MS = 60_000;

/**
 * Everything that must hold before the dashboard opens the database itself: the database migrated, every stored
 * secret under the current key, and what the person running this should know. The database is let go after,
 * since PGlite is one process's alone and the server is another.
 */
async function preflight(config: ReturnType<typeof loadConfig>): Promise<void> {
  const store = await openStore(config);
  try {
    if (store.warning) ui.warn(store.warning);
    const secrets = await checkSecrets(config, store, true);
    const users = await listUsers(store.central);
    let on = 0;
    for (const user of users) if ((await preferences(await store.user(user.id))).active) on++;
    ui.heading(on === 0 ? 'off' : on === users.length ? 'on' : `on for ${on} of ${users.length}`);
    secrets();
    if (!hasClientSecrets(config)) ui.warn(`No Google client yet. Run ${paint.cmd('sift init')}.`);
    else if ((await connectedAddresses(store.central)).length === 0) ui.warn('No Gmail account yet. Open the dashboard and sign in with Google.');
    else if (on === 0) ui.info('Gmail is not changed while Sift is off. Each person turns it on in the dashboard, under Settings.');
  } finally {
    await store.close();
  }
}

/** `sift run`, and with `dev` `sift dev`: Next.js serving the dashboard and doing the work, and its tick each minute. */
export async function run(args: string[], dev = false): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const config = loadConfig();
  startTelemetry(config.settings.sentryDsn);
  try {
    await preflight(config);
    const port = portOption(values.port) ?? config.settings.dashboardPort;
    // Loopback, where a proxy on this machine (`tailscale serve`) reaches it, unless --host says otherwise: a container
    // listens on every interface and its port mapping decides who can reach it.
    const hostname = values.host ?? '127.0.0.1';
    if (!dev) await buildPage();
    const time = () => paint.dim(new Date().toLocaleTimeString(undefined, { hour12: false }));
    const server = await startNext({
      dev,
      port,
      hostname,
      env: { SIFT_HOME: config.home },
      inUse: `Port ${port} is already in use. Is Sift already running? If not, set SIFT_DASHBOARD_PORT in ${config.envPath}.`,
      print: (line) => ui.plain(`${time()}  ${line}`),
    });
    const { url } = config.settings;
    const [first, ...others] = signInAddresses(port, url);
    ui.fields([['Dashboard', paint.bold(first ?? '')], ...others.map((url) => ['', paint.bold(url)] as const)]);
    if (url && new URL(url).hostname === tailscaleName())
      ui.info(`The second needs ${paint.cmd(`tailscale serve --bg ${port}`)} once. Sign in there with Google.`);
    ui.blank();

    const stop = new AbortController();
    let asked = false;
    const ask = () => ((asked = true), stop.abort());
    process.once('SIGINT', ask);
    process.once('SIGTERM', ask);
    void server.exited.then(() => stop.abort());
    const authorization = `Bearer ${cronSecret(sessionSecret(config))}`;
    // As Vercel Cron calls it: every minute, without waiting for the last, since a piece whose run is under way is not begun again.
    while (!stop.signal.aborted) {
      void fetch(`${server.url}/api/cron`, { headers: { authorization } }).then(
        (reply) => reply.ok || ui.plain(`${time()}  The minute's tick failed: ${reply.status}`),
        (error: unknown) => stop.signal.aborted || ui.plain(`${time()}  The minute's tick failed: ${error instanceof Error ? error.message : String(error)}`),
      );
      await sleep(INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => {});
    }
    await server.stop();
    // Stopped by itself: what it printed says why.
    if (!asked) process.exitCode = 1;
  } finally {
    await flushTelemetry();
  }
}

function portOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${value}`);
  return port;
}
