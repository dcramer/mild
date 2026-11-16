import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import type { Sql } from '../store/sql.ts';
import { fileURLToPath } from 'node:url';
import { connectedAddresses, owner, userOf } from '../store/accounts.ts';
import { openUserDb } from '../store/db.ts';
import type { Store } from '../store/store.ts';
import { READS, WRITES } from './api/index.ts';
import type { Context, Write } from './api/route.ts';
import type { Controls, SignIn } from './controls.ts';
import { type Scope, narrow, scopeFor, sees } from './scope.ts';

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
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

const HEADERS = {
  // Subjects and sender names are untrusted. The page only ever renders them as text, and this is the backstop:
  // no inline script, no inline style element, nothing loaded from another origin. `manifest-src` and
  // `worker-src` let the page be installed as an app with its own service worker; both are files of this
  // server's. (`worker-src` would fall back to `script-src` in most browsers, but not in older Safari.)
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { ...HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));

const MAX_BODY = 20_000;

/** Read a small JSON body. Null if it is too large or not a JSON object. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > MAX_BODY) return null;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface DashboardOptions {
  /** Directory holding the built web app. */
  assetsDir?: string;
  /** Names and addresses, besides localhost, that the dashboard answers to. */
  allowedHosts?: readonly string[];
  /**
   * Google sign-in. When given, the dashboard's data and controls are only for someone signed in as a
   * connected account. Without it (tests, tools) there is no check.
   */
  signIn?: SignIn;
  /** Signs session cookies. Required with `signIn`. */
  sessionSecret?: string;
  /** Addresses Google can sign the user in at, to suggest when they opened the dashboard at one it cannot. */
  signInAddresses?: readonly string[];
  /** What the dashboard can ask the rest of sift to do. Without it the page can look but not manage. */
  controls?: Controls;
  /**
   * For working on sift (`sift dev`): the page's files are read afresh on every request, and the page is
   * told to reload when they change or when this process restarts. Same origin and the same content
   * security policy as normal, so a policy violation shows up while developing.
   */
  dev?: boolean;
  now?: () => number;
}

const SESSION_DAYS = 30;
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A session cookie value: who, until when, signed so it cannot be forged or altered. */
function signSession(email: string, secret: string, now: number): string {
  const body = b64(JSON.stringify({ e: email, x: now + SESSION_DAYS * 86_400_000 }));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** The address a session cookie was issued to, or null if it is missing, forged or expired. */
function readSession(value: string | undefined, secret: string, now: number): string | null {
  const [body, signature] = (value ?? '').split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { e?: unknown; x?: unknown };
    return typeof e === 'string' && typeof x === 'number' && x > now ? e : null;
  } catch {
    return null;
  }
}

const cookie = (req: IncomingMessage, name: string) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];

/**
 * The dashboard: where the user watches sift, teaches it and manages it.
 *
 * Who may use it: someone signed in with Google as a connected account. That one sign-in is also what
 * gives sift its access to the account. Requests must be addressed to localhost or one of this
 * machine's own names (which stops another website reaching it through DNS rebinding), and every write
 * must come from the dashboard's own page. The page's static files, its app manifest and service worker
 * among them, are public and hold no data; everything under `/api/` needs the session.
 *
 * What it may do: change what sift has been taught and how it is set up. It never reaches Gmail itself;
 * the few things that do (signing in, undo, pulling in older mail) are handed in and audited as usual.
 */
export function createDashboardServer(store: Store, options: DashboardOptions = {}): Server {
  const assetsDir = options.assetsDir ?? WEB_DIST;
  const builtAssets = listAssets(assetsDir);
  const dev = options.dev ?? false;
  // Changes when the page is rebuilt, and when this process is a new one.
  const boot = Date.now();
  const devVersion = () => {
    const index = join(assetsDir, 'index.html');
    return `${boot}:${existsSync(index) ? statSync(index).mtimeMs : 0}`;
  };
  const now = options.now ?? Date.now;
  const hosts = new Set([...LOCAL_HOSTS, ...(options.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  const { controls, signIn } = options;
  const secret = options.sessionSecret ?? '';
  if (signIn && secret === '') throw new Error('signIn needs a sessionSecret');
  // Sign-ins in flight: the state Google echoes back, with the PKCE verifier and where to return to.
  const pending = new Map<string, { verifier: string; redirectUri: string; addTo: string | null; expires: number }>();

  // What a request with nobody behind it reads: no one's mail.
  let empty: Promise<Sql> | undefined;
  const nobody = () => (empty ??= openUserDb(':memory:'));
  const reads = new Map(READS.map((route) => [route.path, route]));
  const writes = new Map(WRITES.map((route) => [route.path, route]));
  /** Why this person may not make this write, or null if they may. Someone else's data is reported as not there. */
  const refusal = async (route: Write, ctx: Context, body: Record<string, unknown>, scope: Scope): Promise<{ status: number; error: string } | null> => {
    const whose = await route.touches(ctx, body);
    if (whose === 'install') return scope.owner ? null : { status: 403, error: 'Only the person who set sift up can change this.' };
    if (whose === null || whose === 'anyone' || sees(scope, whose.account)) return null;
    return { status: 404, error: 'There is no such thing here.' };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!hosts.has(host)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('The sift dashboard does not answer to this address. Set dashboard.host in sift.toml.');
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const query = url.searchParams;

    // The address the browser used. Behind `tailscale serve` the request arrives from this machine over
    // plain HTTP with the original scheme in a header, which is only believed from this machine.
    const local = req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1';
    const https = local && req.headers['x-forwarded-proto'] === 'https';
    const origin = `${https ? 'https' : 'http'}://${req.headers.host ?? ''}`;
    // Google only returns a browser to localhost or to an HTTPS address.
    const googleCanReturnHere = https || LOCAL_HOSTS.has(host);
    const signedInAs = signIn ? readSession(cookie(req, 'sift_session'), secret, now()) : null;
    const known = signedInAs !== null && signIn?.allowed(signedInAs) ? await userOf(store.central, signedInAs) : null;
    const session = known ? signedInAs : null;
    // What this request may see: the mailboxes of whoever is signed in, in their own database and no
    // one else's. With no sign-in set up (tests, tools) it is the owner's.
    const person = signIn ? known : await owner(store.central);
    const whole = person ? scopeFor(await connectedAddresses(store.central, person.id), person.owner) : scopeFor([], !signIn);
    const ctx: Context = { db: person ? await store.user(person.id) : await nobody(), controls, now };
    const sessionCookie = (value: string, maxAge: number) =>
      `sift_session=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`;

    if (signIn && req.method === 'GET' && url.pathname === '/api/session') {
      const kind = signIn.client();
      const reason = kind === null ? 'no-client' : !googleCanReturnHere ? 'address' : kind === 'desktop' ? 'desktop-client' : null;
      return void json(res, 200, {
        required: true,
        email: session,
        canSignIn: reason === null,
        reason,
        addresses: options.signInAddresses ?? [],
        redirectUri: `${origin}/auth/callback`,
      });
    }
    if (signIn && req.method === 'GET' && url.pathname === '/auth/login') {
      if (signIn.client() === null || !googleCanReturnHere) {
        res.writeHead(303, { location: '/', 'cache-control': 'no-store' }).end();
        return;
      }
      for (const [key, entry] of pending) if (entry.expires < now()) pending.delete(key);
      const state = randomBytes(16).toString('hex');
      const verifier = randomBytes(32).toString('base64url');
      const redirectUri = `${origin}/auth/callback`;
      // Adding a second account is only for someone already signed in.
      pending.set(state, { verifier, redirectUri, addTo: query.get('add') === '1' ? session : null, expires: now() + 600_000 });
      res
        .writeHead(303, { location: signIn.url(redirectUri, state, createHash('sha256').update(verifier).digest('base64url')), 'cache-control': 'no-store' })
        .end();
      return;
    }
    if (signIn && req.method === 'GET' && url.pathname === '/auth/callback') {
      const entry = pending.get(query.get('state') ?? '');
      pending.delete(query.get('state') ?? '');
      const fail = (message: string) => res.writeHead(303, { location: `/?signin=${encodeURIComponent(message)}`, 'cache-control': 'no-store' }).end();
      const code = query.get('code');
      if (!entry || entry.expires < now()) return void fail('That sign-in expired. Try again.');
      if (!code) return void fail(query.get('error') === 'access_denied' ? 'Google did not grant access.' : 'Google did not complete the sign-in.');
      signIn
        .complete(entry.redirectUri, code, entry.verifier, entry.addTo)
        .then((email) =>
          res
            .writeHead(303, {
              location: '/',
              'set-cookie': sessionCookie(signSession(email, secret, now()), SESSION_DAYS * 86_400),
              'cache-control': 'no-store',
            })
            .end(),
        )
        .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
      return;
    }
    if (signIn && session === null && url.pathname.startsWith('/api/')) return void json(res, 401, { error: 'Sign in to use the dashboard.' });
    if (signIn && req.method === 'POST' && url.pathname === '/api/signout') {
      res
        .writeHead(200, { ...HEADERS, 'content-type': 'application/json', 'set-cookie': sessionCookie('', 0), 'cache-control': 'no-store' })
        .end('{"ok":true}');
      return;
    }
    if (!signIn && req.method === 'GET' && url.pathname === '/api/session')
      return void json(res, 200, { required: false, email: null, canSignIn: false, reason: null, addresses: [], redirectUri: '' });

    if (req.method === 'POST') {
      const handler = writes.get(url.pathname);
      // A write must come from the dashboard's own page: a browser sends Origin on every cross-site
      // request, and another site cannot set a custom header or a JSON content type without a preflight
      // this server never approves.
      let origin: string | null = null;
      try {
        origin = new URL(req.headers.origin ?? '').hostname.toLowerCase();
      } catch {
        origin = null;
      }
      const fromOwnPage = origin !== null && hosts.has(origin.includes(':') ? `[${origin}]` : origin);
      if (!handler) return void json(res, 405, { error: 'Not something this dashboard does.' });
      if (!fromOwnPage || req.headers['x-sift'] !== '1' || !(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return void json(res, 403, { error: 'This request did not come from the dashboard.' });
      }
      void readJson(req)
        .then(async (body) => {
          const refused = body && (await refusal(handler, ctx, body, whole));
          if (refused) return void json(res, refused.status, { error: refused.error });
          const result = body && (await handler.run(ctx, body, whole));
          if (result === null) json(res, 400, { error: 'That request is not well formed.' });
          else json(res, 200, result);
        })
        .catch((error: unknown) => json(res, 409, { error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET, POST' }).end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const route = reads.get(url.pathname);
      if (!route) return void json(res, 404, { error: 'Not found' });
      // `mailbox` narrows any read to one of the person's own mailboxes.
      const mailbox = query.get('mailbox');
      const scope = mailbox ? narrow(whole, mailbox) : whole;
      if (!scope) return void json(res, 404, { error: 'No such mailbox' });
      void Promise.resolve()
        .then(() => route.run(ctx, scope, query))
        .then((reply) => json(res, reply.status, reply.body))
        .catch((error: unknown) => json(res, 500, { error: error instanceof Error ? error.message : String(error) }));
      return;
    }

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
    // The page is one document that reads the path (`/rules`, `/settings/accounts`), so a path that names
    // no file gets the page. A name with an extension is a file that is not there.
    // A sender's or a domain's page ends in an address, which has a dot in it and is still a page.
    const isPage = (extname(url.pathname) === '' || /^\/(sender|domain)\//.test(url.pathname)) && !/^\/(auth|dev|assets)\//.test(url.pathname);
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

  return createServer(
    (req, res) =>
      void handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }),
  );
}
