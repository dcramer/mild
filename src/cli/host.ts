import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { type Duplex, Readable } from 'node:stream';
import nextModule from 'next';
import { getWorld } from 'workflow/runtime';
import type { Config, Env } from '../config.ts';
import { NOSNIFF } from '../dashboard/policy.ts';
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
  /** Next.js, and Workflow's world, keep the process alive until closed. */
  close: () => Promise<void>;
}

// Node gives `next`'s exports as the default import; its types, read as CommonJS under NodeNext, put them under `default`.
const createNext = nextModule as unknown as (typeof nextModule)['default'];

/**
 * Next.js for this checkout: the built page, or with `dev` the development server, which rebuilds as the page's
 * code changes. It also serves Workflow's flow route, where the Local World delivers each run, kept in `workflowDir`.
 */
async function nextPage(dev: boolean, workflow: { dir: string; url: string }): Promise<Page> {
  if (!dev) await ensurePageBuilt();
  // Naming the world keeps `withWorkflow` (next.config.js) from putting its data in the build folder.
  Object.assign(process.env, NO_TELEMETRY, { WORKFLOW_TARGET_WORLD: 'local', WORKFLOW_LOCAL_DATA_DIR: workflow.dir, WORKFLOW_LOCAL_BASE_URL: workflow.url });
  // Sift has read its own .env files; Next.js would add the checkout's, such as the production values `vercel env pull` leaves.
  process.env['__NEXT_PROCESSED_ENV'] = 'true';
  const app = createNext({ dev, dir: ROOT });
  await app.prepare();
  return {
    handle: app.getRequestHandler(),
    upgrade: app.getUpgradeHandler(),
    close: async () => {
      await app.close();
      // The world Next.js's copy opened, found where Workflow keeps it: until closed it retries deliveries to the closed listener.
      await (await getWorld()).close?.();
    },
  };
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
            .writeHead(500, { ...NOSNIFF, 'content-type': 'application/json', 'cache-control': 'no-store' })
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

/** The listener at `address`, as this machine reaches it: a wildcard at its own family's loopback, since `::` may take no IPv4. */
export function fromHere(address: string, port: number): string {
  const host = address === '0.0.0.0' ? '127.0.0.1' : address === '::' ? '::1' : address;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/**
 * Workflow's Local World keeps its queue in memory, so a run that a stop or a crash cut off holds its key until the
 * World is started: then it sends each such run again, and hands back the step that was under way.
 * @public `tests/restart.workflow.test.ts` calls it in a worker, as Sift started again.
 */
export async function takeUpRuns(): Promise<void> {
  await (await getWorld()).start?.();
}

/**
 * Serve the dashboard from this process and say where it is, so one process keeps Sift online. Stopping takes no new
 * requests, waits for `settle` (the work under way, which Workflow delivers over open connections), then closes.
 */
export async function serveDashboard(
  config: Config,
  sift: Pick<Sift, 'respond'>,
  options: { port: number; host?: string; dev?: boolean },
): Promise<(settle?: () => Promise<void>) => Promise<void>> {
  const { port } = options;
  // --host replaces the setting: a container listens on every interface and its port mapping decides who can reach it.
  const listen = options.host ? [options.host] : await listenAddresses(config.settings);
  const page = await nextPage(options.dev ?? false, { dir: config.workflowDir, url: fromHere(listen[0]!, port) });
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
  // Once listening: what it sends again is delivered here.
  await takeUpRuns();
  return async (settle) => {
    for (const server of servers) server.close();
    await settle?.();
    for (const server of servers) server.closeAllConnections();
    await page.close();
  };
}

export function portOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${value}`);
  return port;
}
