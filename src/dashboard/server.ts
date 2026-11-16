import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { type FeedbackInput, applyFeedback } from '../learn/feedback.ts';
import { listAccounts } from '../store/accounts.ts';
import { addLabel, updateLabel } from '../store/labels.ts';
import { addRule, removeRule } from '../store/rules.ts';
import type { Controls, SignIn } from './controls.ts';
import { listChanges, listDecisions, listLabelSummaries, listRuleSummaries, listSuggestions, messageDetail, suggestionDetail, summarize } from './queries.ts';
import type { ManageState } from './types.ts';

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

const LABEL_ID = /^[a-z0-9_-]{1,40}$/;
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

const SCOPES = new Set(['sender', 'domain', 'subject', 'once']);

/** Check an answer to a suggestion field by field. Null if it is not well formed. */
function parseFeedback(body: Record<string, unknown>): FeedbackInput | null {
  const { accountId, sender, label, disposition, scope, contains, decisionId, messageId, unsubscribe } = body;
  if (typeof accountId !== 'string' || typeof sender !== 'string') return null;
  if (typeof label !== 'string' || !LABEL_ID.test(label)) return null;
  if (typeof scope !== 'string' || !SCOPES.has(scope)) return null;
  if (disposition !== undefined && disposition !== 'keep' && disposition !== 'archive' && disposition !== 'spam') return null;
  if (contains !== undefined && (typeof contains !== 'string' || contains.length > 200)) return null;
  if (scope === 'subject' && (typeof contains !== 'string' || contains.trim() === '')) return null;
  if (decisionId !== undefined && (typeof decisionId !== 'number' || !Number.isInteger(decisionId))) return null;
  if (messageId !== undefined && !str(messageId)) return null;
  if (unsubscribe !== undefined && typeof unsubscribe !== 'boolean') return null;
  return {
    accountId,
    sender,
    label,
    scope: scope as FeedbackInput['scope'],
    ...(disposition === undefined ? {} : { disposition }),
    ...(typeof contains === 'string' ? { contains } : {}),
    ...(decisionId === undefined ? {} : { decisionId }),
    ...(messageId === undefined ? {} : { messageId }),
    ...(unsubscribe ? { unsubscribe } : {}),
  };
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

const RULE_KEYS = new Set(['from', 'fromDomain', 'to', 'listId', 'subjectContains']);
const str = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const decided = (value: unknown): value is 'keep' | 'archive' | 'spam' => value === 'keep' || value === 'archive' || value === 'spam';
/** What a label can be set to do. `block` is spam plus blocking the sender. */
const outcome = (value: unknown): value is 'keep' | 'archive' | 'spam' | 'block' => decided(value) || value === 'block';
const fromOutcome = (value: 'keep' | 'archive' | 'spam' | 'block') =>
  value === 'block' ? { disposition: 'spam' as const, block: true } : { disposition: value, block: false };

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
export function createDashboardServer(db: DatabaseSync, options: DashboardOptions = {}): Server {
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
  const pending = new Map<string, { verifier: string; redirectUri: string; allowNew: boolean; expires: number }>();

  /** POST handlers. Each validates its own body and returns the response, or null for a malformed body. */
  const writes: Record<string, (body: Record<string, unknown>) => unknown> = {
    '/api/feedback': async (body) => {
      const input = parseFeedback(body);
      if (!input) return null;
      const result = applyFeedback(db, { ...input, mode: controls?.settings().act ? 'act' : 'observe' }, now());
      if (result.corrected === null || !controls) return { ...result, fixed: null };
      // The answer is saved whatever happens next; a mailbox that cannot be put right is reported, not hidden.
      try {
        const undone = await controls.putBack(input.accountId, result.corrected);
        return { ...result, fixed: undone ? 'What sift did to this message in Gmail has been taken back.' : null };
      } catch (error) {
        return {
          ...result,
          fixed: `The answer is saved, but the message could not be put back in Gmail: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    '/api/labels': (body) => {
      const { accountId, id, name, description, disposition, markRead, unsubscribe } = body;
      if (!str(accountId) || !str(id, 40)) return null;
      if (name !== undefined && !str(name, 60)) return null;
      if (description !== undefined && (typeof description !== 'string' || description.length > 600)) return null;
      if (disposition !== undefined && !outcome(disposition)) return null;
      if (markRead !== undefined && typeof markRead !== 'boolean') return null;
      if (unsubscribe !== undefined && typeof unsubscribe !== 'boolean') return null;
      const change: Parameters<typeof updateLabel>[3] = {};
      if (name !== undefined) change.name = name;
      if (description !== undefined) change.description = description;
      if (disposition !== undefined) Object.assign(change, fromOutcome(disposition));
      if (markRead !== undefined) change.markRead = markRead;
      if (unsubscribe !== undefined) change.unsubscribe = unsubscribe;
      if (!updateLabel(db, accountId, id, change, now())) throw new Error(`There is no label "${id}".`);
      return { ok: true };
    },
    '/api/labels/add': (body) => {
      const { accountId, name, description, disposition, markRead, unsubscribe } = body;
      if (!str(accountId) || !str(name, 60) || typeof description !== 'string' || description.length > 600) return null;
      if (!outcome(disposition) || (markRead !== undefined && typeof markRead !== 'boolean')) return null;
      if (unsubscribe !== undefined && typeof unsubscribe !== 'boolean') return null;
      if (!listAccounts(db).some((a) => a.id === accountId)) return null;
      return {
        id: addLabel(
          db,
          accountId,
          { name, description, ...fromOutcome(disposition), ...(markRead ? { markRead } : {}), ...(unsubscribe ? { unsubscribe } : {}) },
          now(),
        ).id,
      };
    },
    '/api/rules': (body) => {
      const { accountId, match, label, disposition, markRead, unsubscribe } = body;
      if (!str(accountId) || typeof label !== 'string' || !LABEL_ID.test(label) || typeof match !== 'object' || match === null) return null;
      if (disposition !== undefined && !decided(disposition)) return null;
      if ((markRead !== undefined && typeof markRead !== 'boolean') || (unsubscribe !== undefined && typeof unsubscribe !== 'boolean')) return null;
      const conditions = Object.entries(match).filter(([, value]) => value !== '');
      if (conditions.length === 0 || !conditions.every(([key, value]) => RULE_KEYS.has(key) && str(value))) return null;
      const extras = { ...(markRead ? { markRead } : {}), ...(unsubscribe ? { subscription: 'unsubscribe' as const } : {}) };
      return {
        id: addRule(
          db,
          accountId,
          { match: Object.fromEntries(conditions), labelId: label, ...(disposition ? { disposition } : {}), ...extras },
          'user',
          now(),
        ),
      };
    },
    '/api/rules/remove': (body) => {
      if (!str(body['id'], 40)) return null;
      if (!removeRule(db, body['id'])) throw new Error('That rule no longer exists.');
      return { ok: true };
    },
    '/api/settings': (body) => {
      const { act, interval, model } = body;
      if (act !== undefined && typeof act !== 'boolean') return null;
      if (interval !== undefined && (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 5 || interval > 86_400)) return null;
      if (model !== undefined && model !== null && (!str(model) || !/^[^/\s]+\/\S+$/.test(model))) return null;
      if (!controls) throw new Error('This dashboard cannot change settings.');
      controls.saveSettings({
        ...(act === undefined ? {} : { act }),
        ...(interval === undefined ? {} : { interval }),
        ...(model === undefined ? {} : { model }),
      });
      return { settings: controls.settings() };
    },
    '/api/guidelines': (body) => {
      if (typeof body['text'] !== 'string' || body['text'].length > 8000) return null;
      if (!controls) throw new Error('This dashboard cannot change the guidelines.');
      controls.saveGuidelines(body['text']);
      return { ok: true };
    },
    '/api/undo': async (body) => {
      if (typeof body['id'] !== 'number' || !Number.isInteger(body['id'])) return null;
      if (!controls) throw new Error('This dashboard cannot undo changes.');
      return { message: await controls.undo(body['id']) };
    },
    '/api/backfill': async (body) => {
      const days = body['days'];
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 30) return null;
      if (!controls) throw new Error('This dashboard cannot pull in mail.');
      const added = await controls.backfill(days);
      controls.checkNow();
      return { added };
    },
    '/api/check': () => {
      if (!controls) throw new Error('Nothing is sorting mail from this dashboard.');
      controls.checkNow();
      return { ok: true };
    },
  };

  const manageState = (): ManageState => {
    const accounts = listAccounts(db);
    const synced = db.prepare('SELECT last_synced_at AS at FROM accounts WHERE id = ?');
    return {
      settings: controls?.settings() ?? { act: false, interval: 60, model: null },
      guidelines: controls?.guidelines() ?? '',
      activity: controls?.activity() ?? { sorting: false, lastPassAt: null, problems: [], expired: [] },
      accounts: accounts.map((a) => ({ id: a.id, email: a.email, lastSyncedAt: (synced.get(a.id) as { at: number | null } | undefined)?.at ?? null })),
      labels: Object.fromEntries(accounts.map((a) => [a.id, listLabelSummaries(db, a.id)])),
    };
  };

  return createServer((req, res) => {
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
    const session = signedInAs !== null && listAccounts(db).some((a) => a.email === signedInAs) ? signedInAs : null;
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
      pending.set(state, { verifier, redirectUri, allowNew: query.get('add') === '1' && session !== null, expires: now() + 600_000 });
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
        .complete(entry.redirectUri, code, entry.verifier, entry.allowNew)
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
      const handler = writes[url.pathname];
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
          const result = body && (await handler(body));
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
      if (url.pathname === '/api/suggestion') return void json(res, 200, suggestionDetail(db, query.get('account') ?? '', query.get('sender') ?? ''));
      if (url.pathname === '/api/rules') return void json(res, 200, { rules: listRuleSummaries(db) });
      if (url.pathname === '/api/suggestions') return void json(res, 200, listSuggestions(db, { includeKept: query.get('kept') === '1' }));
      if (url.pathname === '/api/manage') return void json(res, 200, manageState());
      if (url.pathname === '/api/changes') return void json(res, 200, { changes: listChanges(db, 200) });
      if (url.pathname === '/api/models') {
        void (controls ? controls.models() : Promise.resolve([]))
          .then((models) => json(res, 200, { models }))
          .catch((error: unknown) => json(res, 200, { models: [], error: error instanceof Error ? error.message : String(error) }));
        return;
      }
      return void json(res, 404, { error: 'Not found' });
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
    const isPage = extname(url.pathname) === '' && !/^\/(auth|dev|assets)\//.test(url.pathname);
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
  });
}
