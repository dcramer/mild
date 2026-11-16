import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Config } from '../config.ts';
import { HEADERS } from '../dashboard/server.ts';
import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import type { Host, Sift } from '../app/sift.ts';
import type { Store } from '../store/store.ts';
import { WEB_DIST, ensureWebBuilt } from './web-build.ts';
import { readSecret, writeSecret } from '../secrets.ts';
import { listenAddresses, machineNames, tailscaleName } from './network.ts';
import { paint, ui } from './ui.ts';

/** Loaded by the page in dev mode. Reloads when the page's files change or the server comes back as a new process. */
const DEV_RELOAD_JS = `let seen = null;
new EventSource('/dev/events').onmessage = (event) => {
  if (seen !== null && event.data !== seen) setTimeout(() => location.reload(), 150);
  seen = event.data;
};
`;
const DEV_SCRIPT = '<script type="module" src="/dev/reload.js"></script>';
const DEV_BUILDING = `<!doctype html><html class="dark"><head><meta charset="UTF-8" /><title>sift</title>${DEV_SCRIPT}</head><body>Building the page…</body></html>`;

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

/**
 * The site as a `node:http` server, for `sift run`. With `dev` (`sift dev`), the page is told to reload
 * when its files change or this process restarts, under the same origin and content security policy as
 * normal, so a policy violation shows up while developing.
 */
export function dashboardListener(respond: (request: Request) => Promise<Response>, options: { dev?: boolean; pageDir?: string } = {}): Server {
  const dev = options.dev ?? false;
  const pageDir = options.pageDir ?? WEB_DIST;
  // Changes when the page is rebuilt, and when this process is a new one.
  const boot = Date.now();
  const devVersion = () => {
    const index = join(pageDir, 'index.html');
    return `${boot}:${existsSync(index) ? statSync(index).mtimeMs : 0}`;
  };

  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    if (dev && req.url === '/dev/reload.js') {
      res.writeHead(200, { ...HEADERS, 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(DEV_RELOAD_JS);
      return;
    }
    if (dev && req.url === '/dev/events') {
      res.writeHead(200, { ...HEADERS, 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write('retry: 500\n\n');
      let sent = '';
      const tick = () => {
        const version = devVersion();
        if (version !== sent) res.write(`data: ${(sent = version)}\n\n`);
      };
      tick();
      const timer = setInterval(tick, 300);
      req.on('close', () => clearInterval(timer));
      return;
    }
    const response = await respond(toRequest(req));
    if (!dev) return await send(res, response);
    // In dev nothing is cached, and the page carries the reload script.
    response.headers.set('cache-control', 'no-store');
    if (response.status === 503) {
      res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(DEV_BUILDING);
      return;
    }
    if (!response.headers.get('content-type')?.startsWith('text/html')) return await send(res, response);
    const html = await response.text();
    await send(res, new Response(html.includes('</head>') ? html.replace('</head>', `${DEV_SCRIPT}</head>`) : html + DEV_SCRIPT, response));
  };
  return createServer(
    (req, res) =>
      void serve(req, res).catch((error: unknown) => {
        if (!res.headersSent)
          res
            .writeHead(500, { ...HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' })
            .end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }),
  );
}

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

/** How long a piece of work in `sift run` may start work: as a host's function would cut it off, so the same path runs. */
const LIMIT_MS = 5 * 60_000;

/** What `sift run` and `sift dashboard` give sift as its host: this machine, its home directory, its page. */
export function nodeHost(config: Config, store: Store, ephemeral: Ephemeral, port: number, log: (line: string) => void): Host {
  return { config, store, ephemeral, sessionSecret: sessionSecret(config), ...dashboardAddresses(config, port), pageDir: WEB_DIST, log, limitMs: LIMIT_MS };
}

/**
 * What the dashboard answers to on this machine: any name or address that is this machine, and the one
 * given as SIFT_DASHBOARD_HOST; and where Google can sign someone in.
 */
function dashboardAddresses(config: Config, port: number) {
  const host = config.settings.dashboardHost;
  return { allowedHosts: [...machineNames(), ...(host && host !== 'all' ? [host] : [])], signInAddresses: signInAddresses(port) };
}

/**
 * Serve the dashboard from this process and say where it is. Used by `run`, so one process keeps sift
 * online, and by `dashboard` on its own.
 */
export async function serveDashboard(
  config: Config,
  sift: Pick<Sift, 'respond'>,
  options: { port: number; host?: string; dev?: boolean },
): Promise<() => void> {
  const { port } = options;
  // --host replaces the setting: a container listens on every interface and its port mapping decides who can reach it.
  const listen = options.host ? [options.host] : await listenAddresses(config.settings);
  // In dev the page is rebuilt alongside, and served as it changes.
  if (!options.dev) await ensureWebBuilt();
  const servers = listen.map(() => dashboardListener(sift.respond, options.dev ? { dev: true } : {}));
  await Promise.all(
    servers.map(
      (server, index) =>
        new Promise<void>((resolve, reject) => {
          server.once('error', (error: NodeJS.ErrnoException) =>
            reject(
              error.code === 'EADDRINUSE'
                ? new Error(`Port ${port} is already in use. Is sift already running? If not, set SIFT_DASHBOARD_PORT in ${config.envPath}.`)
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
