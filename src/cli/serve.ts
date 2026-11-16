import { randomBytes } from 'node:crypto';
import type { Config } from '../config.ts';
import type { Controls } from '../dashboard/controls.ts';
import { createDashboardServer } from '../dashboard/server.ts';
import { ensureWebBuilt } from './web-build.ts';
import { readSecret, writeSecret } from '../secrets.ts';
import { people } from '../store/people.ts';
import type { Store } from '../store/store.ts';
import { listenAddresses, machineNames, tailscaleName } from './network.ts';
import { paint, ui } from './ui.ts';
import { buildSignIn } from './google-sign-in.ts';

/**
 * What signs dashboard sessions: `SIFT_SESSION_SECRET`, for a host that keeps no files between starts;
 * otherwise made the first time it is needed and kept in the home directory.
 */
function sessionSecret(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  if (env['SIFT_SESSION_SECRET']) return env['SIFT_SESSION_SECRET'];
  const stored = readSecret(config.dashboardKeyPath, config.keys);
  if (stored !== null) return stored.trim();
  const key = randomBytes(32).toString('base64url');
  writeSecret(config.dashboardKeyPath, key, config.keys);
  return key;
}

/** Addresses Google can sign someone in at: this machine, and its Tailscale name over HTTPS. */
export function signInAddresses(port: number): string[] {
  const name = tailscaleName();
  return [`http://localhost:${port}`, ...(name ? [`https://${name}`] : [])];
}

/**
 * Start serving the dashboard from this process and say where it is. Used by `run`, so one process
 * keeps sift online, and by `dashboard` on its own.
 */
export async function serveDashboard(
  config: Config,
  store: Store,
  options: { port?: number; host?: string; controls: Controls; dev?: boolean },
): Promise<() => void> {
  const { settings } = config;
  const port = options.port ?? settings.dashboardPort;
  // --host replaces the setting: a container listens on every interface and its port mapping decides who can reach it.
  const listen = options.host ? [options.host] : await listenAddresses(settings);
  // Answer to any name or address that is this machine and to nothing else.
  const allowedHosts = [...machineNames(), ...(settings.dashboardHost && settings.dashboardHost !== 'all' ? [settings.dashboardHost] : [])];
  // In dev the page is rebuilt alongside, and served as it changes.
  if (!options.dev) await ensureWebBuilt();

  const servers = listen.map(() =>
    createDashboardServer(people(store), {
      ...(options.dev ? { dev: true } : {}),
      allowedHosts,
      controls: options.controls,
      signIn: buildSignIn(config, store),
      sessionSecret: sessionSecret(config),
      signInAddresses: signInAddresses(port),
    }),
  );
  await Promise.all(
    servers.map(
      (server, index) =>
        new Promise<void>((resolve, reject) => {
          server.once('error', (error: NodeJS.ErrnoException) =>
            reject(
              error.code === 'EADDRINUSE'
                ? new Error(`Port ${port} is already in use. Is sift already running? If not, change dashboard.port in ${config.settingsPath}.`)
                : error,
            ),
          );
          server.listen(port, listen[index], resolve);
        }),
    ),
  );

  const [first, ...others] = signInAddresses(port);
  ui.fields([['Dashboard', paint.bold(first ?? '')], ...others.map((url) => ['', paint.bold(url)] as const)]);
  if (others.length > 0) ui.info(`The second needs ${paint.cmd(`tailscale serve --bg ${port}`)} once. Sign in there with Google.`);
  return () => {
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
  };
}

export function portOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${value}`);
  return port;
}
