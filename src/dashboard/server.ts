import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { type FeedbackInput, applyFeedback } from '../learn/feedback.ts';
import { listAccounts } from '../store/accounts.ts';
import { listCategories, updateCategory } from '../store/categories.ts';
import { addRule, removeRule } from '../store/rules.ts';
import { forgetSender, listSenders, setSender } from '../store/senders.ts';
import type { Controls } from './controls.ts';
import { listChanges, listDecisions, listRuleSummaries, listSuggestions, messageDetail, summarize } from './queries.ts';
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

const DISPOSITIONS = new Set(['keep', 'archive', 'spam', 'review']);
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

/** Check an answer to a suggestion field by field. Null if it is not well formed. */
function parseFeedback(body: Record<string, unknown>): FeedbackInput | null {
  const { accountId, sender, verdict, suggested, correct, category, scope, decisionId } = body;
  if (typeof accountId !== 'string' || typeof sender !== 'string') return null;
  if (verdict !== 'right' && verdict !== 'wrong') return null;
  if (scope !== 'sender' && scope !== 'message') return null;
  if (suggested !== undefined && (typeof suggested !== 'string' || !DISPOSITIONS.has(suggested))) return null;
  if (correct !== undefined && correct !== 'keep' && correct !== 'archive' && correct !== 'spam') return null;
  if (category !== undefined && (typeof category !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(category))) return null;
  if (decisionId !== undefined && (typeof decisionId !== 'number' || !Number.isInteger(decisionId))) return null;
  if (scope === 'message' && decisionId === undefined) return null;
  return {
    accountId,
    sender,
    verdict,
    scope,
    ...(suggested === undefined ? {} : { suggested: suggested as NonNullable<FeedbackInput['suggested']> }),
    ...(correct === undefined ? {} : { correct }),
    ...(category === undefined ? {} : { category }),
    ...(decisionId === undefined ? {} : { decisionId }),
  };
}

export interface DashboardOptions {
  /** Directory holding the built web app. */
  assetsDir?: string;
  /** Names and addresses, besides localhost, that the dashboard answers to. */
  allowedHosts?: readonly string[];
  /**
   * A secret every request must present, as the `sift_key` cookie. Opening `/?key=<it>` sets the cookie.
   * Required whenever the dashboard is reachable from another machine. Without it there is no check.
   */
  accessKey?: string;
  /** What the dashboard can ask the rest of sift to do. Without it the page can look but not manage. */
  controls?: Controls;
  now?: () => number;
}

const RULE_KEYS = new Set(['from', 'fromDomain', 'to', 'listId', 'subjectContains']);
const str = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const decided = (value: unknown): value is 'keep' | 'archive' | 'spam' => value === 'keep' || value === 'archive' || value === 'spam';

function sameKey(given: string | undefined, key: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

const cookie = (req: IncomingMessage, name: string) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];

/**
 * The dashboard: where the user watches sift, teaches it and manages it.
 *
 * Who may use it: requests must be addressed to localhost or one of this machine's own names (which stops
 * another website reaching it through DNS rebinding), and, when an access key is set, must carry it.
 * Every write must also come from the dashboard's own page.
 *
 * What it may do: change what sift has been taught and how it is set up. It never reaches Gmail itself;
 * the few things that do (undo, pulling in older mail) are handed in as `controls` and audited as usual.
 */
export function createDashboardServer(db: DatabaseSync, options: DashboardOptions = {}): Server {
  const assets = listAssets(options.assetsDir ?? WEB_DIST);
  const now = options.now ?? Date.now;
  const hosts = new Set([...LOCAL_HOSTS, ...(options.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  const { accessKey, controls } = options;

  /** POST handlers. Each validates its own body and returns the response, or null for a malformed body. */
  const writes: Record<string, (body: Record<string, unknown>) => unknown> = {
    '/api/feedback': (body) => {
      const input = parseFeedback(body);
      return input && applyFeedback(db, input, now());
    },
    '/api/categories': (body) => {
      const { accountId, key, disposition, label } = body;
      if (!str(accountId) || !str(key, 40)) return null;
      if (disposition !== undefined && !decided(disposition) && disposition !== 'review') return null;
      if (label !== undefined && label !== null && !str(label, 100)) return null;
      const changed = updateCategory(
        db,
        accountId,
        key,
        { ...(disposition === undefined ? {} : { disposition }), ...(label === undefined ? {} : { label }) },
        now(),
      );
      if (!changed) throw new Error(`There is no category "${key}".`);
      return { ok: true };
    },
    '/api/rules': (body) => {
      const { accountId, match, disposition, label } = body;
      if (!str(accountId) || !decided(disposition) || typeof match !== 'object' || match === null) return null;
      if (label !== undefined && !str(label, 100)) return null;
      const conditions = Object.entries(match).filter(([, value]) => value !== '');
      if (conditions.length === 0 || !conditions.every(([key, value]) => RULE_KEYS.has(key) && str(value))) return null;
      return { id: addRule(db, accountId, { match: Object.fromEntries(conditions), disposition, ...(label ? { label } : {}) }, 'user', now()) };
    },
    '/api/rules/remove': (body) => {
      if (!str(body['id'], 40)) return null;
      if (!removeRule(db, body['id'])) throw new Error('That rule no longer exists.');
      return { ok: true };
    },
    '/api/senders': (body) => {
      const { accountId, address, disposition, forget } = body;
      if (!str(accountId) || !str(address)) return null;
      if (forget === true) {
        if (!forgetSender(db, accountId, address)) throw new Error('That sender is not remembered.');
        return { ok: true };
      }
      if (!decided(disposition)) return null;
      setSender(db, accountId, address, disposition, now());
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
    return {
      settings: controls?.settings() ?? { act: false, interval: 60, model: null },
      guidelines: controls?.guidelines() ?? '',
      activity: controls?.activity() ?? { sorting: false, lastPassAt: null, problems: [] },
      accounts: accounts.map((a) => ({ id: a.id, email: a.email, lastSyncedAt: null })),
      categories: Object.fromEntries(
        accounts.map((a) => [
          a.id,
          listCategories(db, a.id).map((c) => ({ key: c.key, name: c.name, description: c.description, disposition: c.disposition, label: c.label ?? null })),
        ]),
      ),
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

    if (accessKey) {
      // The link sift prints carries the key once; it becomes a cookie and is dropped from the address.
      if (req.method === 'GET' && sameKey(query.get('key') ?? undefined, accessKey)) {
        res
          .writeHead(303, {
            location: '/',
            'set-cookie': `sift_key=${accessKey}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`,
            'cache-control': 'no-store',
          })
          .end();
        return;
      }
      if (!sameKey(cookie(req, 'sift_key'), accessKey)) {
        res
          .writeHead(401, { ...HEADERS, 'content-type': 'text/plain', 'cache-control': 'no-store' })
          .end('This dashboard needs its access link. Run `sift status` on the machine running sift and open the link it prints.');
        return;
      }
    }

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
      if (url.pathname === '/api/rules') return void json(res, 200, { rules: listRuleSummaries(db) });
      if (url.pathname === '/api/suggestions') return void json(res, 200, listSuggestions(db, { includeKept: query.get('kept') === '1' }));
      if (url.pathname === '/api/manage') return void json(res, 200, manageState());
      if (url.pathname === '/api/senders') return void json(res, 200, { senders: listSenders(db) });
      if (url.pathname === '/api/changes') return void json(res, 200, { changes: listChanges(db, 200) });
      if (url.pathname === '/api/models') {
        void (controls ? controls.models() : Promise.resolve([]))
          .then((models) => json(res, 200, { models }))
          .catch((error: unknown) => json(res, 200, { models: [], error: error instanceof Error ? error.message : String(error) }));
        return;
      }
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
