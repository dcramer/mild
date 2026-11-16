import { waitUntil } from '@vercel/functions';
import { loadConfig } from '../config.ts';
import { openEphemeral } from '../ephemeral/open.ts';
import { type Sift, createSift } from '../host/sift.ts';
import { openStore } from '../store/store.ts';

/** The time limit of both routes, as `vercel.json` sets it. */
export const MAX_DURATION_S = 300;
/** A tick starts nothing in the last minute, which a model call already under way may need. */
const TICK_MS = (MAX_DURATION_S - 60) * 1000;

/** What a deploy must give, in the environment: nothing is kept in files. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the Vercel project's environment.`);
  return value;
}

/** Open the store as sift would anywhere else. There is no home directory to keep anything in, only `/tmp`. */
export async function openVercelStore() {
  process.env['SIFT_HOME'] ??= '/tmp/sift';
  const config = loadConfig();
  required('DATABASE_URL');
  return { config, store: await openStore(config) };
}

async function open(): Promise<Sift> {
  const { config, store } = await openVercelStore();
  const ephemeral = await openEphemeral(required('REDIS_URL'));
  const production = process.env['VERCEL_PROJECT_PRODUCTION_URL'];
  return await createSift({
    config,
    store,
    ephemeral,
    sessionSecret: required('SIFT_SESSION_SECRET'),
    // The deployment's own names, and a domain of the project's own given as dashboard.host.
    allowedHosts: [process.env['VERCEL_URL'], process.env['VERCEL_BRANCH_URL'], production, config.settings.dashboardHost].filter((name) => name !== undefined),
    signInAddresses: production ? [`https://${production}`] : [],
    log: (line) => process.stdout.write(`${line}\n`),
    background: (work) => waitUntil(work),
    tickMs: TICK_MS,
  });
}

// One per instance, reused while Vercel keeps it: a database pool and a Redis connection, nothing about any request.
let opened: Promise<Sift> | undefined;
const sift = () => (opened ??= open().catch((error: unknown) => ((opened = undefined), Promise.reject(error))));

/** Every request Vercel's CDN does not answer from the built page: the API and sign-in. */
export async function respond(request: Request): Promise<Response> {
  return await (await sift()).respond(request);
}

/** Vercel Cron, each minute. Vercel sends `CRON_SECRET` as a bearer token; nothing else may start a tick. */
export async function cron(request: Request): Promise<Response> {
  if (request.headers.get('authorization') !== `Bearer ${required('CRON_SECRET')}`) return new Response(null, { status: 401 });
  await (await sift()).tick();
  return new Response(null, { status: 204 });
}
