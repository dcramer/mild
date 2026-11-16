import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { Config } from '../config.ts';
import { type Dashboard, HEADERS } from '../dashboard/server.ts';
import { WEB_DIST, ensureWebBuilt } from './web-build.ts';
import { readSecret, writeSecret } from '../secrets.ts';
import { listenAddresses, machineNames, tailscaleName } from './network.ts';
import { paint, ui } from './ui.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

/** Every file under `dir`, keyed by its URL path. Built once: requests can only ever name a file that was listed. */
function listAssets(dir: string): Map<string, { file: string; type: string }> {
  const assets = new Map<string, { file: string; type: string }>();
  if (!existsSync(dir)) return assets;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const type = TYPES[extname(entry.name)];
    if (type) assets.set(`/${relative(dir, file).split(sep).join('/')}`, { file, type });
  }
  return assets;
}

/** Loaded by the page in dev mode. Reloads when the page's files change or the server comes back as a new process. */
const DEV_RELOAD_JS = `let seen = null;
new EventSource('/dev/events').onmessage = (event) => {
  if (seen !== null && event.data !== seen) setTimeout(() => location.reload(), 150);
  seen = event.data;
};
`;
const DEV_SCRIPT = '<script type="module" src="/dev/reload.js"></script>';
const DEV_BUILDING = `<!doctype html><html class="dark"><head><meta charset="UTF-8" /><title>sift</title>${DEV_SCRIPT}</head><body>Building the page…</body></html>`;

export interface ListenerOptions {
  /** Directory holding the built web app. */
  assetsDir?: string;
  /**
   * For working on sift (`sift dev`): the page's files are read afresh on every request, and the page is
   * told to reload when they change or when this process restarts. Same origin and the same content
   * security policy as normal, so a policy violation shows up while developing.
   */
  dev?: boolean;
}

/** `node:http`'s request as a web `Request`. The URL's host is a placeholder: the handler reads the Host header. */
function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : Readable.toWeb(req);
  return new Request(new URL(req.url ?? '/', 'http://localhost'), { method: req.method ?? 'GET', headers, body, duplex: 'half' });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = Object.fromEntries(response.headers);
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers).end(Buffer.from(await response.arrayBuffer()));
}

/**
 * The dashboard as a `node:http` server, for `sift run`: the page's files from `assetsDir` (and in dev,
 * the reload script and its event stream), everything else from the dashboard's handler.
 */
export function dashboardListener(dashboard: Dashboard, options: ListenerOptions = {}): Server {
  const assetsDir = options.assetsDir ?? WEB_DIST;
  const builtAssets = listAssets(assetsDir);
  const dev = options.dev ?? false;
  // Changes when the page is rebuilt, and when this process is a new one.
  const boot = Date.now();
  const devVersion = () => {
    const index = join(assetsDir, 'index.html');
    return `${boot}:${existsSync(index) ? statSync(index).mtimeMs : 0}`;
  };

  const files = (url: URL, req: IncomingMessage, res: ServerResponse) => {
    if (dev && url.pathname === '/dev/reload.js') {
      res.writeHead(200, { ...HEADERS, 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(DEV_RELOAD_JS);
      return;
    }
    if (dev && url.pathname === '/dev/events') {
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

    const assets = dev ? listAssets(assetsDir) : builtAssets;
    if (assets.size === 0) {
      if (dev) res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(DEV_BUILDING);
      else res.writeHead(503, { ...HEADERS, 'content-type': 'text/plain' }).end('The dashboard has not been built. Run: pnpm build:web');
      return;
    }
    // The page is one document that reads the path (`/rules`, `/sender/…`), so a path that names
    // no file gets the page. A name with an extension is a file that is not there.
    // A sender's or a domain's page ends in an address, which has a dot in it and is still a page.
    const isPage = (extname(url.pathname) === '' || /^\/(sender|domain)\//.test(url.pathname)) && !/^\/(dev|assets)\//.test(url.pathname);
    const asset = assets.get(url.pathname) ?? (isPage ? assets.get('/index.html') : undefined);
    if (!asset) {
      res.writeHead(404, { ...HEADERS, 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    // Vite fingerprints everything under /assets, so those never change; the page itself must always be fresh.
    const cache = !dev && url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store';
    const body = readFileSync(asset.file);
    const html = dev && asset.file.endsWith('index.html') ? body.toString('utf8') : null;
    const page = html === null ? body : html.includes('</head>') ? html.replace('</head>', `${DEV_SCRIPT}</head>`) : html + DEV_SCRIPT;
    res.writeHead(200, { ...HEADERS, 'content-type': asset.type, 'cache-control': cache }).end(page);
  };

  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // A request to another name goes to the handler, which refuses it.
    if (req.method === 'GET' && !/^\/(api|auth)\//.test(url.pathname) && dashboard.answers(req.headers.host)) return files(url, req, res);
    await send(res, await dashboard.handle(toRequest(req), req.socket.remoteAddress));
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
export function sessionSecret(config: Config, env: NodeJS.ProcessEnv = process.env): string {
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
 * What the dashboard answers to on this machine: any name or address that is this machine, and the one
 * set in sift.toml; and where Google can sign someone in.
 */
export function dashboardAddresses(config: Config, port: number) {
  const host = config.settings.dashboardHost;
  return { allowedHosts: [...machineNames(), ...(host && host !== 'all' ? [host] : [])], signInAddresses: signInAddresses(port) };
}

/**
 * Serve the dashboard from this process and say where it is. Used by `run`, so one process keeps sift
 * online, and by `dashboard` on its own.
 */
export async function serveDashboard(config: Config, dashboard: Dashboard, options: { port: number; host?: string; dev?: boolean }): Promise<() => void> {
  const { port } = options;
  // --host replaces the setting: a container listens on every interface and its port mapping decides who can reach it.
  const listen = options.host ? [options.host] : await listenAddresses(config.settings);
  // In dev the page is rebuilt alongside, and served as it changes.
  if (!options.dev) await ensureWebBuilt();
  const servers = listen.map(() => dashboardListener(dashboard, options.dev ? { dev: true } : {}));
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
