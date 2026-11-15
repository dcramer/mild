import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { type Server, type ServerResponse, createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { listDecisions, listRuleSummaries, messageDetail, summarize } from './queries.ts';

/** Where `pnpm build:web` puts the built web app. */
export const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
};

const HEADERS = {
  // Subjects and sender names are untrusted. The page only ever renders them as text, and this is the backstop:
  // no inline script, no inline style element, nothing loaded from another origin.
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ALLOWED_DAYS = new Set([1, 7, 30, 90]);

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

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { ...HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));

export interface DashboardOptions {
  /** Directory holding the built web app. */
  assetsDir?: string;
  /** Names and addresses, besides localhost, that the dashboard answers to. */
  allowedHosts?: readonly string[];
  now?: () => number;
}

/**
 * A read-only view of the database. There is no login, so who can reach it is decided by where it
 * listens. It also answers only requests addressed to localhost or a name the user configured, which
 * stops another website reaching it through DNS rebinding.
 */
export function createDashboardServer(db: DatabaseSync, options: DashboardOptions = {}): Server {
  const assets = listAssets(options.assetsDir ?? WEB_DIST);
  const now = options.now ?? Date.now;
  const hosts = new Set([...LOCAL_HOSTS, ...(options.allowedHosts ?? []).map((h) => h.toLowerCase())]);

  return createServer((req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!hosts.has(host)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('The sift dashboard does not answer to this address. Set dashboard.host in sift.toml.');
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' }).end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const query = url.searchParams;

    if (url.pathname.startsWith('/api/')) {
      const days = Number(query.get('days') ?? 7);
      if (!ALLOWED_DAYS.has(days)) return void json(res, 400, { error: 'days must be 1, 7, 30 or 90' });

      if (url.pathname === '/api/summary') return void json(res, 200, summarize(db, days, now()));
      if (url.pathname === '/api/decisions') {
        const text = (name: string) => query.get(name) || undefined;
        const stage = text('stage');
        const disposition = text('disposition');
        const search = text('q');
        const result = listDecisions(
          db,
          {
            days,
            ...(stage ? { stage } : {}),
            ...(disposition ? { disposition } : {}),
            ...(search ? { search } : {}),
            limit: Number(query.get('limit') ?? 50) || 50,
            offset: Number(query.get('offset') ?? 0) || 0,
          },
          now(),
        );
        return void json(res, 200, result);
      }
      if (url.pathname === '/api/message') {
        const detail = messageDetail(db, query.get('account') ?? '', query.get('id') ?? '');
        return void json(res, detail ? 200 : 404, detail ?? { error: 'No such message' });
      }
      if (url.pathname === '/api/rules') return void json(res, 200, { rules: listRuleSummaries(db) });
      return void json(res, 404, { error: 'Not found' });
    }

    if (assets.size === 0) {
      res.writeHead(503, { ...HEADERS, 'content-type': 'text/plain' }).end('The dashboard has not been built. Run: pnpm build:web');
      return;
    }
    const asset = assets.get(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!asset) {
      res.writeHead(404, { ...HEADERS, 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    // Vite fingerprints everything under /assets, so those never change; the page itself must always be fresh.
    const cache = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store';
    res.writeHead(200, { ...HEADERS, 'content-type': asset.type, 'cache-control': cache }).end(readFileSync(asset.file));
  });
}
