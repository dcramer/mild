import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { getWorld } from 'workflow/runtime';
import { localHost } from '../cli/host.ts';
import { cronSecret as localCronSecret } from '../cli/session.ts';
import { NotSetUp, cronSecret as vercelCronSecret, vercelHost } from '../vercel/host.ts';
import { checkedIn, flushTelemetry, reportError, traced } from '../telemetry.ts';
import type { Work } from '../work/run.ts';
import { type Host, type Sift, createSift } from './sift.ts';

/** The two hosts, one chosen per process: Vercel's from its environment, `mild run`'s from the home directory. */
const HOSTS = {
  vercel: { open: vercelHost, cronSecret: async () => vercelCronSecret() },
  local: { open: () => localHost(), cronSecret: async () => localCronSecret((await host()).sessionSecret) },
};
const chosen = () => (process.env['VERCEL'] ? HOSTS.vercel : HOSTS.local);

const HOST = Symbol.for('sift.host');
const OFFERED = Symbol.for('sift.offered');
/**
 * Next.js may load this module once for each bundle that imports it (a route, the flow route, instrumentation), so
 * the host, with its database and connections, is kept for the whole process. A test offers its own Mild for a
 * run's step to call, from a copy of `src/` Workflow's build bundled apart from its own.
 */
const slots = globalThis as typeof globalThis & { [HOST]?: Promise<Host>; [OFFERED]?: Pick<Sift, 'work'> };

const host = (): Promise<Host> =>
  (slots[HOST] ??= chosen()
    .open()
    .then((opened) => {
      if (chosen() === HOSTS.local) closeOnStop(opened);
      return opened;
    })
    .catch((error: unknown) => {
      slots[HOST] = undefined;
      throw error;
    }));

/**
 * Next.js stops on SIGTERM or SIGINT by letting the requests under way finish, then calling `process.exit`. PGlite
 * not closed by then is left as after a crash, recovered at the next open, and a copy of it may not open
 * (docs/deploy.md), so that exit waits for the store to close.
 */
function closeOnStop(opened: Host) {
  const stopping = () => {
    const exit = process.exit.bind(process);
    process.exit = ((code?: number) =>
      void opened.store
        .close()
        .catch(reportError)
        .finally(() => exit(code))) as typeof process.exit;
  };
  process.once('SIGTERM', stopping);
  process.once('SIGINT', stopping);
}

/** Put together by each copy of this module, so a change `next dev` reloads is in the next request. */
let opened: Promise<Sift> | undefined;
const sift = () =>
  (opened ??= host()
    .then(createSift)
    .catch((error: unknown) => {
      opened = undefined;
      throw error;
    }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** The API and sign-in, `app/api/` and `app/auth/`. Until a Vercel project is set up, what it still needs. */
export async function respond(request: Request): Promise<Response> {
  try {
    const opened = await sift();
    return await opened.respond(request);
  } catch (error) {
    if (error instanceof NotSetUp) return json(503, { error: error.message, missing: error.missing });
    // Opening failed: its words may name a path or a database.
    reportError(error);
    return json(500, { error: 'Mild could not do that.' });
  } finally {
    // An instance may be frozen once it has answered: what is waiting is sent first.
    waitUntil(flushTelemetry());
  }
}

/** Whether a call carries the host's cron secret. On Vercel, checked before anything is opened. */
async function fromCron(request: Request): Promise<boolean> {
  const expected = Buffer.from(`Bearer ${await chosen().cronSecret()}`);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** `/api/cron`, each minute, from Vercel Cron or `mild run`: begins a run for each piece of what is due. */
export async function cron(request: Request): Promise<Response> {
  if (!(await fromCron(request))) return new Response(null, { status: 401 });
  try {
    await checkedIn(async () => traced('sift.tick', 'tick', {}, async () => (await sift()).tick()));
  } finally {
    waitUntil(flushTelemetry());
  }
  return new Response(null, { status: 204 });
}

/** A Workflow run's step: its piece, done by this process's Mild, and what it left for Sentry sent before the instance can be frozen. */
export async function work(piece: Work): Promise<void> {
  try {
    await (slots[OFFERED] ?? (await sift())).work(piece);
  } finally {
    await flushTelemetry();
  }
}

/** @public `tests/flow.workflow.test.ts` and `tests/restart.workflow.test.ts` give a run's step a Mild of their own. */
export const offerSift = (offered: Pick<Sift, 'work'>) => void (slots[OFFERED] = offered);

/**
 * As the server starts (`instrumentation.ts`). Under `mild run` the host is opened first, which says where the
 * World keeps its runs. Workflow's Local World keeps its queue in memory, so a run that a stop or a crash cut off
 * holds its key until the World is started: then it sends each such run again, and hands back the step that was
 * under way. On Vercel the platform's queue does this, and the host is opened by the first request.
 */
export async function takeUpRuns(): Promise<void> {
  if (chosen() === HOSTS.local) await host();
  await (await getWorld()).start?.();
}
