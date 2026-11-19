import { loadConfig } from '../config.ts';
import { openEphemeral } from '../ephemeral/open.ts';
import { begin } from '../sift/flow.ts';
import type { Host } from '../sift/sift.ts';
import { openStore } from '../store/store.ts';
import { startTelemetry } from '../telemetry.ts';

/** The time limit of every route of Sift's own. */
export const MAX_DURATION_S = 300;
/**
 * A piece of work starts nothing in its last minute, which a model call already under way may need. Pieces run
 * in Workflow's flow route, whose limit is the plan's longest: 300 s on Hobby, the least of them.
 */
const LIMIT_MS = (MAX_DURATION_S - 60) * 1000;

/** What a deploy must give, in the environment: nothing is kept in files. `CRON_SECRET` because without it nothing runs. */
const REQUIRED = ['DATABASE_URL', 'REDIS_URL', 'SIFT_GOOGLE_CLIENT_ID', 'SIFT_GOOGLE_CLIENT_SECRET', 'SIFT_SESSION_SECRET', 'CRON_SECRET'] as const;

function required(name: (typeof REQUIRED)[number]): string {
  const value = process.env[name];
  if (!value) throw new NotSetUp([name]);
  return value;
}

/** The settings the project still needs: said to whoever opens the site, since they are names and nothing secret. */
export class NotSetUp extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Set ${missing.join(', ')} in the Vercel project's environment, then deploy again.`);
    this.missing = missing;
  }
}

/** What Vercel Cron sends `api/cron`: in the project's environment only. Without it nothing passes. */
export const cronSecret = () => required('CRON_SECRET');

/** A Vercel instance's host, all from the environment, refused before anything is opened while any setting is missing. */
export async function vercelHost(): Promise<Host> {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new NotSetUp(missing);
  process.env['SIFT_HOME'] ??= '/tmp/sift';
  const config = loadConfig();
  startTelemetry(config.settings.sentryDsn, process.env['VERCEL_ENV'] ? { environment: process.env['VERCEL_ENV'] } : {});
  const store = await openStore(config);
  const ephemeral = await openEphemeral(required('REDIS_URL'));
  const production = process.env['VERCEL_PROJECT_PRODUCTION_URL'];
  const url = config.settings.url ?? (production && `https://${production}`);
  return {
    config,
    store,
    ephemeral,
    sessionSecret: required('SIFT_SESSION_SECRET'),
    ...(url ? { url } : {}),
    allowedHosts: [process.env['VERCEL_URL'], process.env['VERCEL_BRANCH_URL'], production, url && new URL(url).hostname].filter((name) => name !== undefined),
    signInAddresses: url ? [url] : [],
    forwarded: true,
    log: (line) => process.stdout.write(`${line}\n`),
    begin,
    limitMs: LIMIT_MS,
  };
}
