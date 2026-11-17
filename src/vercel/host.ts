import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { loadConfig } from '../config.ts';
import { openEphemeral } from '../ephemeral/open.ts';
import { begin } from '../app/flow.ts';
import { type Sift, createSift } from '../app/sift.ts';
import { openStore } from '../store/store.ts';
import { checkedIn, flushTelemetry, startTelemetry, traced } from '../telemetry.ts';

/** The time limit of every route of Sift's own. */
export const MAX_DURATION_S = 300;
/**
 * A piece of work starts nothing in its last minute, which a model call already under way may need. Pieces run
 * in Workflow's flow route, whose limit is the plan's longest: 300 s on Hobby, the least of them.
 */
const LIMIT_MS = (MAX_DURATION_S - 60) * 1000;

/**
 * Whether a call is Vercel Cron's. `CRON_SECRET` is in the project's environment only, and Vercel sends it to
 * `api/cron`. Without the variable nothing passes: `required` throws rather than compare against nothing.
 */
const fromCron = (request: Request) => {
  const expected = Buffer.from(`Bearer ${required('CRON_SECRET')}`);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/** What a deploy must give, in the environment: nothing is kept in files. `CRON_SECRET` because without it nothing runs. */
const REQUIRED = ['DATABASE_URL', 'REDIS_URL', 'SIFT_GOOGLE_CLIENT_ID', 'SIFT_GOOGLE_CLIENT_SECRET', 'SIFT_SESSION_SECRET', 'CRON_SECRET'] as const;

function required(name: (typeof REQUIRED)[number]): string {
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
  startTelemetry(config.settings.sentryDsn, process.env['VERCEL_ENV'] ? { environment: process.env['VERCEL_ENV'] } : {});
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
    begin,
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
  try {
    return await opened.respond(request);
  } finally {
    // An instance may be frozen once it has answered: what is waiting is sent first.
    waitUntil(flushTelemetry());
  }
}

/** Vercel Cron, each minute: begins a run for each piece of what is due. */
export async function cron(request: Request): Promise<Response> {
  if (!fromCron(request)) return new Response(null, { status: 401 });
  try {
    await checkedIn(async () => traced('sift.tick', 'tick', {}, async () => (await sift()).tick()));
  } finally {
    waitUntil(flushTelemetry());
  }
  return new Response(null, { status: 204 });
}

/** This instance's Sift, for the steps of Workflow runs: what a piece leaves for Sentry is sent before the instance can be frozen. */
export async function forSteps(): Promise<Pick<Sift, 'work'>> {
  const opened = await sift();
  return { work: (piece) => sentAfter(opened.work(piece)) };
}

/** `work`, then what it left for Sentry sent. */
async function sentAfter<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } finally {
    await flushTelemetry();
  }
}
