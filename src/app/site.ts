import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { type Dashboard, HEADERS } from '../dashboard/server.ts';

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

/** Every file under `dir`, keyed by its URL path: a request can only ever name a file that was listed. */
function listFiles(dir: string): Map<string, { file: string; type: string }> {
  const files = new Map<string, { file: string; type: string }>();
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const type = TYPES[extname(entry.name)];
    if (type) files.set(`/${relative(dir, file).split(sep).join('/')}`, { file, type });
  }
  return files;
}

/**
 * The whole site: the built page from `pageDir` under the dashboard's own headers, and everything else
 * (the API, sign-in, a request to a name it does not answer to) from the dashboard's handler. The same for
 * every host, so the content security policy is set in one place.
 */
export function site(dashboard: Dashboard, pageDir: string): (request: Request) => Promise<Response> {
  let files = listFiles(pageDir);
  const file = (path: string) => {
    // The page is one document that reads the path (`/rules`, `/sender/…`), so a path that names no file
    // gets the page; a name with an extension is a file that is not there. A sender's or a domain's page
    // ends in an address, which has a dot in it and is still a page.
    const isPage = (extname(path) === '' || /^\/(sender|domain)\//.test(path)) && !/^\/(dev|assets)\//.test(path);
    return files.get(path) ?? (isPage ? files.get('/index.html') : undefined);
  };
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (request.method !== 'GET' || /^\/(api|auth)\//.test(pathname) || !dashboard.answers(request.headers.get('host'))) return await dashboard.handle(request);
    // A page rebuilt since (`sift dev`) has files of new names.
    if (!file(pathname)) files = listFiles(pageDir);
    if (files.size === 0)
      return new Response('The dashboard has not been built. Run: pnpm build:web', { status: 503, headers: { ...HEADERS, 'content-type': 'text/plain' } });
    const found = file(pathname);
    if (!found) return new Response('Not found', { status: 404, headers: { ...HEADERS, 'content-type': 'text/plain' } });
    // Vite fingerprints everything under /assets, so those never change; the page itself must always be fresh.
    const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store';
    return new Response(readFileSync(found.file), { headers: { ...HEADERS, 'content-type': found.type, 'cache-control': cache } });
  };
}
