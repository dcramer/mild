import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { loadConfig } from '../config.ts';
import { openEphemeral } from '../ephemeral/open.ts';
import { z } from 'zod';
import type { Work } from '../work/run.ts';
import { type Sift, createSift } from '../app/sift.ts';
import { openStore } from '../store/store.ts';

/** The time limit of every route, as `vercel.json` sets it. */
export const MAX_DURATION_S = 300;
/** A piece of work starts nothing in the last minute, which a model call already under way may need. */
const LIMIT_MS = (MAX_DURATION_S - 60) * 1000;

/** A piece of due work, as one call hands it to the next: ids, checked before anything is opened with them. */
const Piece = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pass'), person: z.int().positive(), account: z.string().min(3) }),
  z.strictObject({ kind: z.literal('upkeep'), person: z.int().positive() }),
  z.strictObject({ kind: z.literal('backfill'), person: z.int().positive(), account: z.string().min(3), days: z.int().min(1).max(30) }),
  z.strictObject({ kind: z.literal('eval'), person: z.int().positive(), run: z.int().positive() }),
]) satisfies z.ZodType<Work>;

/**
 * Whether a call comes from the deployment itself. `CRON_SECRET` is in the project's environment only:
 * Vercel sends it to `api/cron`, and `fanOut` sends it to `api/work`, only ever at the deployment's own
 * address. Without the variable nothing passes: `required` throws rather than compare against nothing.
 */
const fromSift = (request: Request) => {
  const expected = Buffer.from(`Bearer ${required('CRON_SECRET')}`);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/**
 * Hand each piece of what is due to a call of its own (`api/work.ts`), so each has its own time limit and
 * opens only what its ids name. Resolves once every call has taken its piece, not when they finish.
 */
export async function fanOut(due: Sift['due'], people?: readonly number[]): Promise<void> {
  // Deployment Protection guards each deployment's own address, so production calls its production domain; a
  // preview can be reached only with Vercel's bypass for automation, sent when the project has one.
  const domain = process.env['VERCEL_ENV'] === 'production' ? process.env['VERCEL_PROJECT_PRODUCTION_URL'] : process.env['VERCEL_URL'];
  const self = `https://${domain ?? required('VERCEL_URL')}/api/work`;
  const bypass = process.env['VERCEL_AUTOMATION_BYPASS_SECRET'];
  const headers = {
    authorization: `Bearer ${required('CRON_SECRET')}`,
    'content-type': 'application/json',
    ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
  };
  const taken = await Promise.allSettled((await due(people)).map((piece) => fetch(self, { method: 'POST', headers, body: JSON.stringify(piece) })));
  const refused = taken.filter((call) => call.status === 'rejected' || call.value.status !== 202).length;
  // What was not taken is due again at the next tick.
  if (refused > 0) process.stdout.write(`${refused} of ${taken.length} pieces of work were not taken\n`);
}

/** What a deploy must give, in the environment: nothing is kept in files. `CRON_SECRET` because without it nothing runs. */
const REQUIRED = ['DATABASE_URL', 'REDIS_URL', 'SIFT_GOOGLE_CLIENT_ID', 'SIFT_GOOGLE_CLIENT_SECRET', 'SIFT_SESSION_SECRET', 'CRON_SECRET'] as const;

function required(name: (typeof REQUIRED)[number] | 'VERCEL_URL'): string {
  const value = process.env[name];
  if (!value) throw new NotSetUp([name]);
  return value;
}

/** The settings the project still needs: said to whoever opens the site, since they are names and nothing secret. */
class NotSetUp extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Set ${missing.join(', ')} in the Vercel project's environment, then deploy again.`);
    this.missing = missing;
  }
}

/** The settings, all from the environment, refused before anything is opened while any is missing. */
function loadVercelConfig() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new NotSetUp(missing);
  process.env['SIFT_HOME'] ??= '/tmp/sift';
  return loadConfig();
}

async function open(): Promise<Sift> {
  const config = loadVercelConfig();
  const store = await openStore(config);
  const ephemeral = await openEphemeral(required('REDIS_URL'));
  const production = process.env['VERCEL_PROJECT_PRODUCTION_URL'];
  return await createSift({
    config,
    store,
    ephemeral,
    sessionSecret: required('SIFT_SESSION_SECRET'),
    // The deployment's own names, and a domain of the project's own given as SIFT_DASHBOARD_HOST.
    allowedHosts: [process.env['VERCEL_URL'], process.env['VERCEL_BRANCH_URL'], production, config.settings.dashboardHost].filter((name) => name !== undefined),
    signInAddresses: production ? [`https://${production}`] : [],
    log: (line) => process.stdout.write(`${line}\n`),
    start: (sift, people) => waitUntil(fanOut(sift.due, people)),
    limitMs: LIMIT_MS,
  });
}

// One per instance, reused while Vercel keeps it: a database pool and a Redis connection, nothing about any request.
let opened: Promise<Sift> | undefined;
const sift = () => (opened ??= open().catch((error: unknown) => ((opened = undefined), Promise.reject(error))));

/** Every request Vercel's CDN does not answer from the built page: the API and sign-in. Until the project is set up, what it still needs. */
export async function respond(request: Request): Promise<Response> {
  let opened: Sift;
  try {
    opened = await sift();
  } catch (error) {
    if (!(error instanceof NotSetUp)) throw error;
    return new Response(JSON.stringify({ error: error.message, missing: error.missing }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  return await opened.respond(request);
}

/** Vercel Cron, each minute: hands out what is due. */
export async function cron(request: Request): Promise<Response> {
  if (!fromSift(request)) return new Response(null, { status: 401 });
  await fanOut((await sift()).due);
  return new Response(null, { status: 204 });
}

/** The piece of work a call to `api/work` carries, if it is one from the deployment itself; otherwise the refusal. */
export async function admit(request: Request): Promise<Work | Response> {
  // Checked before the body is read, so a stranger's call costs nothing.
  if (request.method !== 'POST' || !fromSift(request)) return new Response(null, { status: 401 });
  const piece = Piece.safeParse(await request.json().catch(() => null));
  return piece.success ? piece.data : new Response(null, { status: 400 });
}

/** One piece of work, taken at once and done after the reply, within this call's own time limit. */
export async function work(request: Request): Promise<Response> {
  const piece = await admit(request);
  if (piece instanceof Response) return piece;
  waitUntil((await sift()).work(piece));
  return new Response(null, { status: 202 });
}
