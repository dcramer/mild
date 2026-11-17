import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { type Duplex, Readable } from 'node:stream';
import nextModule from 'next';
import type { Config, Env } from '../config.ts';
import { HEADERS } from '../dashboard/policy.ts';
import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import type { Host, Sift } from '../app/sift.ts';
import type { Store } from '../store/store.ts';
import { NO_TELEMETRY, ROOT, ensurePageBuilt } from './page-build.ts';
import { readSecret, writeSecret } from '../secrets.ts';
import { reportError } from '../telemetry.ts';
import { listenAddresses, machineNames, tailscaleName } from './network.ts';
import { paint, ui } from './ui.ts';

/** Addresses of this machine: a forwarded scheme is believed only from one, as `tailscale serve` sends it. */
const LOCAL_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * `node:http`'s request as a web `Request`. The URL's host is a placeholder (the handler reads the Host
 * header); its scheme is the one the browser used. Behind `tailscale serve` the request arrives from this
 * machine over plain HTTP with the original scheme in a header, which is only believed from this machine.
 */
function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
  const https = LOCAL_PEERS.has(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-proto'] === 'https';
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : Readable.toWeb(req);
  return new Request(new URL(req.url ?? '/', https ? 'https://localhost' : 'http://localhost'), { method: req.method ?? 'GET', headers, body, duplex: 'half' });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = Object.fromEntries(response.headers);
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers).end(Buffer.from(await response.arrayBuffer()));
}

/** The page: Next.js (`app/`), answering in this process. Absent where only the API is wanted (tests). */
export interface Page {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** The development server's live reload. */
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;
  /** Next.js keeps the process alive until it is closed. */
  close: () => Promise<void>;
}

// Node gives `next`'s exports as the default import; its types, read as CommonJS under NodeNext, put them under `default`.
const createNext = nextModule as unknown as (typeof nextModule)['default'];

/** Next.js for this checkout: the built page, or with `dev` the development server, which rebuilds as the page's code changes. */
async function nextPage(dev: boolean): Promise<Page> {
  if (!dev) await ensurePageBuilt();
  Object.assign(process.env, NO_TELEMETRY);
  const app = createNext({ dev, dir: ROOT });
  await app.prepare();
  return { handle: app.getRequestHandler(), upgrade: app.getUpgradeHandler(), close: () => app.close() };
}

/** The site as a `node:http` server, for `sift run`: the API and sign-in from `respond`, everything else from the page. */
export function dashboardListener(respond: (request: Request) => Promise<Response>, page?: Page): Server {
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    if (page && !/^\/(api|auth)\//.test(req.url ?? '/')) return await page.handle(req, res);
    await send(res, await respond(toRequest(req)));
  };
  const server = createServer(
    (req, res) =>
      void serve(req, res).catch((error: unknown) => {
        // The handler answers its own errors; one here is the adapter's, and its words may name a path.
        reportError(error);
        if (!res.headersSent)
          res
            .writeHead(500, { ...HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' })
            .end(JSON.stringify({ error: 'Sift could not do that.' }));
      }),
  );
  if (page) server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => void page.upgrade(req, socket, head).catch(() => socket.destroy()));
  return server;
}

/**
 * What signs dashboard sessions: `SIFT_SESSION_SECRET`, for a host that keeps no files between starts;
 * otherwise made the first time it is needed and kept in the home directory.
 */
function sessionSecret(config: Config, env: Env = process.env): string {
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

/** How long a piece of work in `sift run` may start work: as a host's function would cut it off, so the same path runs. */
const LIMIT_MS = 5 * 60_000;

/** What `sift run` gives sift as its host: this machine and its home directory. */
export function nodeHost(config: Config, store: Store, ephemeral: Ephemeral, port: number, log: (line: string) => void): Host {
  return { config, store, ephemeral, sessionSecret: sessionSecret(config), ...dashboardAddresses(config, port), log, limitMs: LIMIT_MS };
}

/**
 * What the dashboard answers to on this machine: any name or address that is this machine, and the one
 * given as SIFT_DASHBOARD_HOST; and where Google can sign someone in.
 */
function dashboardAddresses(config: Config, port: number) {
  const host = config.settings.dashboardHost;
  return { allowedHosts: [...machineNames(), ...(host && host !== 'all' ? [host] : [])], signInAddresses: signInAddresses(port) };
}

/** Serve the dashboard from this process and say where it is, so one process keeps Sift online. */
export async function serveDashboard(
  config: Config,
  sift: Pick<Sift, 'respond'>,
  options: { port: number; host?: string; dev?: boolean },
): Promise<() => Promise<void>> {
  const { port } = options;
  // --host replaces the setting: a container listens on every interface and its port mapping decides who can reach it.
  const listen = options.host ? [options.host] : await listenAddresses(config.settings);
  const page = await nextPage(options.dev ?? false);
  const servers = listen.map(() => dashboardListener(sift.respond, page));
  await Promise.all(
    servers.map(
      (server, index) =>
        new Promise<void>((resolve, reject) => {
          server.once('error', (error: NodeJS.ErrnoException) =>
            reject(
              error.code === 'EADDRINUSE'
                ? new Error(`Port ${port} is already in use. Is Sift already running? If not, set SIFT_DASHBOARD_PORT in ${config.envPath}.`)
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
  return async () => {
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
    await page.close();
  };
}

export function portOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${value}`);
  return port;
}
